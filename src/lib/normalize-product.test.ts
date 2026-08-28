import { describe, expect, it } from "vitest";
import { compareCart } from "@/lib/compare-cart";
import {
  calculateProductSimilarity,
  findBestMatch,
  findClosestCanonicalProductId,
} from "@/lib/matching";
import {
  classifyProduct,
  normalizeProductName,
  normalizeProductNameForMatching,
} from "@/lib/normalize-product";
import { getProductSubtotal, getUnitPrice } from "@/lib/pricing";
import { mockProducts } from "@/data/mock-catalog";

describe("normalizeProductName", () => {
  it("normaliza acentos, caixa e pontuação", () => {
    expect(normalizeProductName("COCA-COLA PET 2LT")).toBe("coca cola pet 2 l");
  });

  it("remove stop words para matching", () => {
    expect(normalizeProductNameForMatching("Molho de tomate com manjericão")).toBe(
      "molho tomate manjericao"
    );
  });
});

describe("calculateProductSimilarity", () => {
  const coca = mockProducts.find((product) => product.id === "amantino-mock-refrigerante-coca-2l")!;
  const agua = mockProducts.find((product) => product.id === "amantino-mock-agua-1-5l")!;
  const leite = mockProducts.find((product) => product.id === "escola-mock-leite-1l")!;
  const papelHigienico = mockProducts.find(
    (product) => product.id === "amantino-mock-papel-higienico-12un"
  )!;

  it("encontra similaridade alta para o mesmo produto", () => {
    expect(calculateProductSimilarity("Coca Cola 2L", coca)).toBeGreaterThan(0.7);
  });

  it("penaliza embalagens incompatíveis", () => {
    expect(calculateProductSimilarity("Coca Cola 2L", agua)).toBeLessThan(0.45);
  });

  it("penaliza categoria conflitante", () => {
    expect(calculateProductSimilarity("Papel toalha 2un", papelHigienico)).toBe(0);
  });

  it("penaliza produto com base semantica diferente", () => {
    expect(calculateProductSimilarity("Leite condensado 395g", leite)).toBe(0);
  });
});

describe("classifyProduct", () => {
  it("identifica categorias diferentes para evitar falso positivo", () => {
    expect(classifyProduct("Papel toalha 2 unidades")).toBe("papel-toalha");
    expect(classifyProduct("Papel higiênico 12 unidades")).toBe("papel-higienico");
  });
});

describe("findBestMatch", () => {
  it("recusa match ambíguo entre embalagens e nomes próximos", () => {
    const result = findBestMatch("Papel toalha 2un", [
      mockProducts.find((product) => product.id === "escola-mock-papel-toalha-2un")!,
      mockProducts.find((product) => product.id === "escola-mock-papel-higienico-12un")!,
    ]);
    expect(result?.product.id).toBe("escola-mock-papel-toalha-2un");
  });
});

describe("findClosestCanonicalProductId", () => {
  const canonicalProducts = [
    { id: "arroz-5kg", name: "Arroz Tipo 1 5kg", normalizedName: "arroz tipo 1 5 kg" },
    { id: "coca-2l", name: "Refrigerante Coca-Cola 2L", normalizedName: "refrigerante coca cola 2 l" },
    { id: "molho-tomate", name: "Molho de Tomate Tradicional 300g" },
  ];

  it("retorna id canonico para nomes raspados com acentos, stop words e ordem diferente", () => {
    expect(findClosestCanonicalProductId("Coca Cola Refrigerante PET 2LT", canonicalProducts)).toBe(
      "coca-2l"
    );
  });

  it("aceita pequenas diferenças de digitação acima do limiar", () => {
    expect(findClosestCanonicalProductId("Refrogerante Coca Cola 2L", canonicalProducts)).toBe(
      "coca-2l"
    );
  });

  it("recusa nomes abaixo do limiar de similaridade", () => {
    expect(findClosestCanonicalProductId("Sabonete hidratante", canonicalProducts)).toBeNull();
  });
});

describe("pricing", () => {
  it("calcula subtotal do produto", () => {
    expect(getProductSubtotal(8.49, 3)).toBe(25.47);
  });

  it("calcula preço por kg", () => {
    const queijo = mockProducts.find((product) => product.id === "escola-mock-queijo-mussarela-500g")!;
    expect(getUnitPrice(queijo)).toEqual({ value: 49.9, unit: "kg" });
  });

  it("calcula preço por litro", () => {
    const oleo = mockProducts.find((product) => product.id === "escola-mock-oleo-900ml")!;
    expect(getUnitPrice(oleo)).toEqual({ value: 9.766666666666666, unit: "l" });
  });
});

describe("compareCart", () => {
  const productsByStore = {
    escola: mockProducts.filter((product) => product.store === "escola"),
    amantino: mockProducts.filter((product) => product.store === "amantino"),
    bh: mockProducts.filter((product) => product.store === "bh"),
    bahamas: mockProducts.filter((product) => product.store === "bahamas"),
  };

  it("calcula total do carrinho", () => {
    const result = compareCart(
      [
        { query: "Arroz 5kg", quantity: 2 },
        { query: "Feijão 1kg", quantity: 1 },
      ],
      productsByStore
    );

    expect(result.stores.escola.total).toBe(64.29);
  });

  it("define supermercado vencedor quando ambos encontram tudo", () => {
    const result = compareCart(
      [
        { query: "Arroz 5kg", quantity: 2 },
        { query: "Feijão 1kg", quantity: 5 },
        { query: "Óleo 900ml", quantity: 3 },
      ],
      productsByStore
    );

    expect(result.winner.store).toBe("bahamas");
  });

  it("calcula economia em reais e percentual", () => {
    const result = compareCart([{ query: "Manteiga Viçosa 500g", quantity: 2 }], productsByStore);
    expect(result.winner.savings).toBe(1.22);
    expect(result.winner.savingsPercentage).toBe(3.2);
  });

  it("marca produto inexistente em uma loja como não encontrado", () => {
    const custom = {
      escola: productsByStore.escola.filter((product) => !product.name.includes("Alface")),
      amantino: productsByStore.amantino,
      bh: productsByStore.bh,
      bahamas: productsByStore.bahamas,
    };

    const result = compareCart([{ query: "Alface unidade", quantity: 1 }], custom);
    expect(result.stores.escola.foundItems).toBe(0);
    expect(result.stores.escola.complete).toBe(false);
    expect(result.winner.store).toBeNull();
  });
});
