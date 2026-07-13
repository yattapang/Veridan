import type { MetadataRoute } from "next";
import { siteMeta } from "@/lib/site-content";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/login"],
    },
    sitemap: `${siteMeta.siteUrl}/sitemap.xml`,
  };
}
