/**
 * AssetLens — keyword search over your owned Unity Asset Store library.
 * Public engine API (spec §8 standalone core).
 */
export {
  AssetLensEngine,
  type EngineOptions,
  type LoginImportOptions,
  type LoginImportResult,
} from "./engine.js";

// Browser login (spec §5.1, §9)
export {
  runBrowserLogin,
  type BrowserLauncher,
  type LoginBrowser,
  type LaunchOptions,
  type OwnedIdsResult,
  type RunBrowserLoginOptions,
  type BrowserLoginResult,
} from "./auth/browserLogin.js";
export {
  fileSessionStore,
  type SessionStore,
} from "./auth/sessionStore.js";
export { playwrightLauncher } from "./auth/playwrightLauncher.js";

// Domain types
export type {
  CatalogProduct,
  Coverage,
  Source,
  FileTypeBucket,
  ProductFile,
  IndexedProduct,
  ProductPageMetadata,
  SearchHit,
  GroupedSearchResult,
} from "./domain/types.js";

// Index / search
export { openDatabase, type DB } from "./index/db.js";
export {
  Repository,
  type IndexStats,
  type LocalFolderRow,
  type LocalFolderInput,
} from "./index/repository.js";
export {
  search,
  searchFiles,
  searchProducts,
  groupByProduct,
  buildMatchQuery,
  DEFAULT_WEIGHTS,
  DEFAULT_LOCAL_BOOST,
  type SearchOptions,
  type ColumnWeights,
} from "./index/search.js";

// Catalog
export {
  parseMyAssets,
  parseMyAssetsText,
  type ParseResult,
} from "./catalog/parseMyAssets.js";

// Unpacking
export {
  parseUnityPackageFile,
  parseUnityPackageBuffer,
  type ParsedPackage,
  type ParseOptions,
} from "./unpack/unitypackage.js";

// Local
export {
  scanCache,
  statPackage,
  isUnityPackage,
  type ScannedPackage,
} from "./local/scanCache.js";
export {
  indexLocalCache,
  indexPackage,
  type LocalIndexResult,
  type LocalIndexOptions,
} from "./local/localIndexer.js";
export { buildCatalogMatcher, normalizeKey } from "./local/matchCatalog.js";
export { walkFiles } from "./local/walk.js";
export {
  scanFolder,
  indexFolder,
  buildFolderIndexedProduct,
  folderInfoFromRow,
  folderProductId,
  isFolderProductId,
  FOLDER_PRODUCT_PREFIX,
  type LocalFolderInfo,
  type LocalFolderStatus,
  type FolderScanResult,
} from "./local/folderIndexer.js";

// Store / online
export {
  type HttpClient,
  type HttpResponse,
  nodeHttp,
} from "./store/http.js";
export {
  fetchAnonymousSession,
  sessionFromCookieHeader,
  sessionFromCsrfCookie,
  type StoreSession,
} from "./store/csrf.js";
export { createStoreClient, type StoreClient } from "./store/graphql.js";
export {
  fetchOnlineProductTree,
  fetchAssetNodes,
  reconstructPaths,
} from "./store/previewAssets.js";
export {
  parseProductPage,
  fetchProductMetadata,
} from "./store/productPage.js";
export {
  fetchOnlineProducts,
  type OnlineFetchResult,
} from "./online/fetchOnline.js";
export { enrichProducts, type EnrichResult } from "./online/enrich.js";

// Config
export {
  liveEnv,
  resolveCacheRoot,
  defaultCacheRoot,
  dataDir,
  defaultDbPath,
  defaultSessionStatePath,
  type PathEnv,
} from "./config/paths.js";

// Actions
export {
  revealCommand,
  openCommand,
  downloadCommand,
  spawnRunner,
  type OsCommand,
  type CommandRunner,
} from "./actions/actions.js";
export {
  folderPickerCommand,
  pickFolder,
  captureRunner,
  type CaptureRunner,
} from "./actions/folderPicker.js";

// Store constants (operation strings live here — spec §10)
export {
  STORE_ORIGIN,
  storeUrl,
  storeSearchUrl,
  kharmaLink,
} from "./store/constants.js";

// Local web GUI server (spec §8 local-web UI)
export {
  startGuiServer,
  createGuiServer,
  resolveWebRoot,
  buildOverview,
  type GuiServerOptions,
  type GuiServerHandle,
  type GuiServerDeps,
  type OverviewPayload,
} from "./server/index.js";
