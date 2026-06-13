import { openDatabase } from "../../src/index/db.js";
import { Repository } from "../../src/index/repository.js";
import type {
  CatalogProduct,
  IndexedProduct,
  ProductFile,
} from "../../src/domain/types.js";
import { bucketForPath, baseNameOf, extOf } from "../../src/domain/fileType.js";
import { storeUrl } from "../../src/store/constants.js";

/** Open an ephemeral in-memory index with a fresh schema. */
export function memoryRepo(): Repository {
  return new Repository(openDatabase({ path: ":memory:" }));
}

export function catalogProduct(
  over: Partial<CatalogProduct> & Pick<CatalogProduct, "id">,
): CatalogProduct {
  return {
    name: `Product ${over.id}`,
    publisher: "Test Publisher",
    isHidden: false,
    ...over,
  };
}

export function fileFrom(
  fullPath: string,
  source: ProductFile["source"] = "local",
  nestedPkg?: string,
): ProductFile {
  return {
    fullPath,
    fileName: baseNameOf(fullPath),
    ext: extOf(fullPath),
    typeBucket: bucketForPath(fullPath),
    ...(nestedPkg ? { nestedPkg } : {}),
    source,
  };
}

export function indexedProduct(
  over: Partial<Omit<IndexedProduct, "product">> & {
    product: CatalogProduct;
    paths?: string[];
  },
): IndexedProduct {
  const source = over.source ?? "local";
  const paths = over.paths ?? [];
  return {
    product: over.product,
    ...(over.category !== undefined ? { category: over.category } : {}),
    tags: over.tags ?? [],
    ...(over.description !== undefined ? { description: over.description } : {}),
    isWrapper: over.isWrapper ?? false,
    coverage: over.coverage ?? (paths.length > 0 ? "deep" : "shallow"),
    source,
    storeUrl: over.storeUrl ?? storeUrl(over.product.id),
    ...(over.localPath !== undefined ? { localPath: over.localPath } : {}),
    files: over.files ?? paths.map((p) => fileFrom(p, source)),
  };
}
