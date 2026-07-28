import "i18next";
import type { defaultNS, resources } from "@/src/i18n/resources";

// Strongly typed translation keys — t() only accepts keys that exist in
// the English (reference) resource files
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS;
    resources: (typeof resources)["en"];
    returnNull: false;
  }
}
