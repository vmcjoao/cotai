import { Prisma, ProductSource, ProductUnit, StandardUnit } from "@prisma/client";
import db from "@/lib/db";
import {
  getNormalizedPackageText,
  getNormalizedProductName,
} from "@/lib/normalize-product";
import { storeMeta } from "@/lib/store";
import { Product, StoreKey } from "@/providers/types";

const productUnitMap: Record<NonNullable<Product["unit"]>, ProductUnit> = {
  g: ProductUnit.GRAM,
  kg: ProductUnit.KILOGRAM,
  ml: ProductUnit.MILLILITER,
  l: ProductUnit.LITER,
  un: ProductUnit.UNIT,
};

const storeWebsiteUrls: Record<StoreKey, string> = {
  escola: "https://supermercadoescola.org.br/",
  amantino: "https://amantino.marketmine.com.br/principal",
  bh: "https://superbh.app/",
  bahamas: "https://bahamas.com.br/",
};

function mapSource(source: Product["source"]) {
  return source === "real" ? ProductSource.REAL : ProductSource.MOCK;
}

function mapUnit(unit?: Product["unit"]) {
  return unit ? productUnitMap[unit] : undefined;
}

function canonicalizeProduct(product: Product): Product {
  return {
    ...product,
    normalizedName: getNormalizedProductName(product),
    packageText: getNormalizedPackageText(product.packageText) ?? product.packageText,
    brand: product.brand ? getNormalizedProductName(product.brand) : undefined,
  };
}

function standardizeQuantity(product: Product) {
  if (!product.quantity || !product.unit) {
    return {
      standardizedQuantity: undefined,
      standardizedUnit: undefined,
    };
  }

  if (product.unit === "kg") {
    return {
      standardizedQuantity: product.quantity * 1000,
      standardizedUnit: StandardUnit.GRAM,
    };
  }

  if (product.unit === "g") {
    return {
      standardizedQuantity: product.quantity,
      standardizedUnit: StandardUnit.GRAM,
    };
  }

  if (product.unit === "l") {
    return {
      standardizedQuantity: product.quantity * 1000,
      standardizedUnit: StandardUnit.MILLILITER,
    };
  }

  if (product.unit === "ml") {
    return {
      standardizedQuantity: product.quantity,
      standardizedUnit: StandardUnit.MILLILITER,
    };
  }

  return {
    standardizedQuantity: product.quantity,
    standardizedUnit: StandardUnit.UNIT,
  };
}

function productPayload(product: Product): Prisma.ProductUncheckedCreateInput {
  const { standardizedQuantity, standardizedUnit } = standardizeQuantity(product);

  return {
    id: product.id,
    externalId: product.externalId,
    name: product.name,
    normalizedName: product.normalizedName,
    brand: product.brand,
    packageText: product.packageText,
    quantity: product.quantity,
    unit: mapUnit(product.unit),
    standardizedQuantity,
    standardizedUnit,
    imageUrl: product.imageUrl,
    productUrl: product.productUrl,
    source: mapSource(product.source),
    available: product.available,
  };
}

function productUpdatePayload(product: Product): Prisma.ProductUncheckedUpdateInput {
  const { id: _id, ...payload } = productPayload(product);
  return payload;
}

async function findExistingProduct(product: Product, storeId: string) {
  const normalizedName = getNormalizedProductName(product);
  const packageText = getNormalizedPackageText(product.packageText) ?? product.packageText;

  return db.product.findFirst({
    where: {
      OR: [
        { id: product.id },
        product.externalId
          ? {
              externalId: product.externalId,
              priceHistory: { some: { storeId } },
            }
          : undefined,
        {
          normalizedName,
          packageText,
          priceHistory: { some: { storeId } },
        },
      ].filter(Boolean) as Prisma.ProductWhereInput[],
    },
  });
}

export async function persistScrapedProducts(products: Product[]) {
  const savedProducts: Product[] = [];

  for (const scrapedProduct of products) {
    const product = canonicalizeProduct(scrapedProduct);
    const store = await db.store.upsert({
      where: { key: product.store },
      update: {
        name: storeMeta[product.store].label,
        slug: product.store,
        websiteUrl: storeWebsiteUrls[product.store],
      },
      create: {
        key: product.store,
        name: storeMeta[product.store].label,
        slug: product.store,
        websiteUrl: storeWebsiteUrls[product.store],
      },
    });

    const existingProduct = await findExistingProduct(product, store.id);
    const dbProduct = await db.product.upsert({
      where: { id: existingProduct?.id ?? product.id },
      update: productUpdatePayload(product),
      create: productPayload(product),
    });

    await db.priceHistory.create({
      data: {
        productId: dbProduct.id,
        storeId: store.id,
        price: product.price,
        originalPrice: product.originalPrice,
        promotion: product.promotion,
        source: mapSource(product.source),
        observedAt: new Date(product.updatedAt),
      },
    });

    await db.promotion.deleteMany({
      where: {
        productId: dbProduct.id,
        storeId: store.id,
        source: mapSource(product.source),
      },
    });

    if (product.promotion) {
      await db.promotion.create({
        data: {
          productId: dbProduct.id,
          storeId: store.id,
          title: product.name,
          price: product.price,
          originalPrice: product.originalPrice,
          discountPercentage: product.discountPercentage,
          active: true,
          sourceUrl: product.productUrl,
          source: mapSource(product.source),
          startsAt: new Date(product.updatedAt),
        },
      });
    }

    savedProducts.push({ ...product, id: dbProduct.id });
  }

  return savedProducts;
}
