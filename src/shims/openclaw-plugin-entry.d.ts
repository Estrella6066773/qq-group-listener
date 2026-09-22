declare module "openclaw/plugin-sdk/plugin-entry" {
  export function definePluginEntry(def: {
    id: string;
    name: string;
    description?: string;
    register: (api: any) => void;
  }): unknown;
}
