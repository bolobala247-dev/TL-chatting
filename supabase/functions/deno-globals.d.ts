declare namespace Deno {
  export function serve(
    handler: (request: Request) => Response | Promise<Response>
  ): void;

  export namespace env {
    export function get(key: string): string | undefined;
  }
}

declare module "https://esm.sh/@supabase/supabase-js@2" {
  export { createClient } from "@supabase/supabase-js";
}

declare module "jsr:@supabase/functions-js/edge-runtime.d.ts" {}
