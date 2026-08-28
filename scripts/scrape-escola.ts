import { scrapeSupermercadoEscolaProducts } from "@/scrapers/supermercado-escola";

const args = process.argv.slice(2);
const queryIndex = args.indexOf("--query");

async function main() {
  const query = queryIndex >= 0 ? args[queryIndex + 1] : undefined;
  const products = await scrapeSupermercadoEscolaProducts({ query });

  console.log(
    query
      ? `Supermercado Escola: ${products.length} produto(s) atualizados para "${query}".`
      : `Supermercado Escola: ${products.length} produto(s) atualizados no banco.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
