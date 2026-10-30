declare module "*.sql" {
  const source: string;
  export default source;
}

declare module "@kanbun/model/migrations/workspace/migrations.js" {
  const bundle: {
    journal: { entries: { idx: number; tag: string }[] };
    migrations: Record<string, string>;
  };
  export default bundle;
}
