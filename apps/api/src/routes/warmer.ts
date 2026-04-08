import { Hono } from "hono";
import type { ApiBindings } from "../types";

export const createWarmerRoutes = (): Hono<ApiBindings> => {
  const router = new Hono<ApiBindings>();

  router.get("/", (c) =>
    c.json({
      status: {
        success: true,
        details: "Warm request completed.",
      },
      timestamp: new Date().toISOString(),
    }),
  );

  return router;
};
