import { extractPackaging, inferBrand, normalizeProductName } from "@/lib/normalize-product";
import { persistScrapedProducts } from "@/lib/product-persistence";
import { Product } from "@/providers/types";

type EscolaDataLayerItem = {
  item_id?: string | number;
  item_name?: string;
  price?: string | number;
  item_category?: string;
};

type ScrapeEscolaOptions = {
  query?: string;
  categoryUrls?: string[];
  maxPages?: number;
};

const ESCOLA_BASE_URL = "https://supermercadoescola.org.br";
const DEFAULT_CATEGORY_URLS = [
  `${ESCOLA_BASE_URL}/categoria/produtos-vi-osa`,
  `${ESCOLA_BASE_URL}/categoria/arroz`,
  `${ESCOLA_BASE_URL}/categoria/leites`,
  `${ESCOLA_BASE_URL}/categoria/feij-o`,
  `${ESCOLA_BASE_URL}/categoria/caf-s`,
  `${ESCOLA_BASE_URL}/categoria/refrigerantes`,
  `${ESCOLA_BASE_URL}/categoria/queijos`,
  `${ESCOLA_BASE_URL}/categoria/manteiga`,
];

async function fetchPublic(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      accept: "text/html,application/json,*/*;q=0.8",
      "user-agent": "CotaI-Hackathon/1.0 (+supermercado-escola-scraper)",
    },
  });

  if (!response.ok) {
    throw new Error(`Falha ao consultar ${url}: HTTP ${response.status}`);
  }

  return response.text();
}

function absoluteUrl(pathOrUrl?: string) {
  if (!pathOrUrl) {
    return undefined;
  }

  return new URL(pathOrUrl, ESCOLA_BASE_URL).toString();
}

function parsePrice(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const match = value.match(/(?:R\$\s*)?(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})/);
  if (!match) {
    return null;
  }

  const normalized = match[1].replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const price = Number(normalized);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function htmlDecode(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(value: string) {
  return htmlDecode(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function toProduct(input: {
  externalId?: string;
  name: string;
  price: number;
  imageUrl?: string;
  productUrl?: string;
  category?: string;
  updatedAt: string;
}) {
  const name = stripTags(input.name);
  const normalizedName = normalizeProductName(name);

  if (!normalizedName || normalizedName.length < 3) {
    return null;
  }

  const packaging = extractPackaging(name);
  const externalId = input.externalId;
  const identity = externalId ?? `${normalizedName}|${packaging.packageText ?? ""}`;

  return {
    id: `escola-real-${stableHash(identity)}`,
    store: "escola",
    externalId,
    name,
    normalizedName,
    brand: inferBrand(name),
    quantity: packaging.quantity,
    unit: packaging.unit,
    packageText: packaging.packageText,
    price: input.price,
    promotion: false,
    available: true,
    imageUrl: absoluteUrl(input.imageUrl),
    productUrl: absoluteUrl(input.productUrl),
    source: "real",
    updatedAt: input.updatedAt,
  } satisfies Product;
}

function extractDataLayerProducts(html: string, pageUrl: string, updatedAt: string) {
  const products: Product[] = [];

  for (const json of extractDataLayerObjects(html)) {
    const parsed = safeJsonParse<{ ecommerce?: { items?: EscolaDataLayerItem[] } }>(json);
    const items = parsed?.ecommerce?.items ?? [];

    for (const item of items) {
      const price = parsePrice(item.price);
      if (!item.item_name || price === null) {
        continue;
      }

      const product = toProduct({
        externalId: item.item_id ? String(item.item_id) : undefined,
        name: item.item_name,
        price,
        category: item.item_category,
        productUrl: pageUrl,
        updatedAt,
      });

      if (product) {
        products.push(product);
      }
    }
  }

  return products;
}

function extractDataLayerObjects(html: string) {
  const results: string[] = [];
  const marker = "dataLayer.push(";
  let searchStart = 0;

  while (searchStart < html.length) {
    const markerIndex = html.indexOf(marker, searchStart);
    if (markerIndex < 0) {
      break;
    }

    const objectStart = html.indexOf("{", markerIndex + marker.length);
    if (objectStart < 0) {
      break;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = objectStart; index < html.length; index += 1) {
      const char = html[index];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === "\"") {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          results.push(html.slice(objectStart, index + 1));
          searchStart = index + 1;
          break;
        }
      }
    }

    if (searchStart <= markerIndex) {
      searchStart = markerIndex + marker.length;
    }
  }

  return results.filter((json) => json.includes("\"items\"") || json.includes("items"));
}

function safeJsonParse<T>(value: string) {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function extractProductCards(html: string, pageUrl: string, updatedAt: string) {
  const products: Product[] = [];
  const cardRegex = /<div class="produto-card[\s\S]*?<\/div>\s*<\/div>/g;

  for (const cardMatch of html.matchAll(cardRegex)) {
    const card = cardMatch[0];
    const name = card.match(/<h3 class="produto-nome">([\s\S]*?)<\/h3>/)?.[1];
    const price = parsePrice(card.match(/<span class="preco-atual">\s*([\s\S]*?)\s*<\/span>/)?.[1]);

    if (!name || price === null) {
      continue;
    }

    const productPath = card.match(/window\.location='([^']+)'/)?.[1];
    const imageUrl = card.match(/<img[^>]+src="([^"]+)"/)?.[1];
    const externalId =
      card.match(/data-url="\/produto\/modal\?id=([^"]+)"/)?.[1] ??
      card.match(/\/produto\/imagem\?id=([^"]+)/)?.[1];

    const product = toProduct({
      externalId,
      name,
      price,
      imageUrl,
      productUrl: productPath ?? pageUrl,
      updatedAt,
    });

    if (product) {
      products.push(product);
    }
  }

  return products;
}

function extractCategoryId(html: string) {
  return html.match(/produtos-ajax\?categoria_id=(\d+)/)?.[1] ?? null;
}

async function scrapeCategory(categoryUrl: string, maxPages: number, updatedAt: string) {
  const firstPageHtml = await fetchPublic(categoryUrl);
  const products = [
    ...extractDataLayerProducts(firstPageHtml, categoryUrl, updatedAt),
    ...extractProductCards(firstPageHtml, categoryUrl, updatedAt),
  ];
  const categoryId = extractCategoryId(firstPageHtml);

  if (categoryId) {
    for (let page = 1; page <= maxPages; page += 1) {
      const pageUrl = `${ESCOLA_BASE_URL}/produto/produtos-ajax?categoria_id=${categoryId}&page=${page}`;
      const fragment = await fetchPublic(pageUrl);
      const pageProducts = extractProductCards(fragment, categoryUrl, updatedAt);

      if (pageProducts.length === 0) {
        break;
      }

      products.push(...pageProducts);
    }
  }

  return dedupeProducts(products);
}

export async function scrapeSupermercadoEscolaProducts(options: ScrapeEscolaOptions = {}) {
  const updatedAt = new Date().toISOString();
  const maxPages = options.maxPages ?? 4;
  const categoryUrls =
    options.categoryUrls ??
    (options.query
      ? [`${ESCOLA_BASE_URL}/catalogsearch/result/?q=${encodeURIComponent(options.query)}`]
      : DEFAULT_CATEGORY_URLS);

  const batches = await Promise.allSettled(
    categoryUrls.map((categoryUrl) => scrapeCategory(categoryUrl, maxPages, updatedAt))
  );

  for (const batch of batches) {
    if (batch.status === "rejected") {
      console.error("Falha ao raspar produtos do Supermercado Escola:", batch.reason);
    }
  }

  const products = dedupeProducts(
    batches.flatMap((batch) => (batch.status === "fulfilled" ? batch.value : []))
  );

  if (options.query) {
    const normalizedQuery = normalizeProductName(options.query);
    return persistScrapedProducts(
      products.filter((product) => product.normalizedName.includes(normalizedQuery))
    );
  }

  return persistScrapedProducts(products);
}

function dedupeProducts(products: Product[]) {
  const map = new Map<string, Product>();
  for (const product of products) {
    const key = `${product.store}|${product.externalId ?? product.normalizedName}|${product.packageText ?? ""}`;
    const current = map.get(key);
    if (!current || product.price < current.price) {
      map.set(key, product);
    }
  }
  return [...map.values()];
}
