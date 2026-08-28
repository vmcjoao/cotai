import { scrapeAllAmantinoSeededProducts, scrapeAmantinoProducts } from "@/scrapers/amantino";

const args = process.argv.slice(2);
const queryIndex = args.indexOf("--query");
const promotionsOnly = args.includes("--promocoes");

async function main() {
  if (queryIndex >= 0 && args[queryIndex + 1]) {
    const query = args[queryIndex + 1];
    const products = await scrapeAmantinoProducts({ query });
    console.log(`Amantino: ${products.length} produto(s) atualizados para "${query}".`);
    return;
  }

  if (promotionsOnly) {
    const promotions = await scrapeAmantinoProducts({ promotionsOnly: true });
    console.log(`Amantino: ${promotions.length} promoção(ões) atualizadas.`);
    return;
  }

  const products = await scrapeAllAmantinoSeededProducts();
  console.log(`Amantino: ${products.length} produto(s) atualizados no banco.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
