import type { MetadataRoute } from "next";
import { siteMeta } from "@/lib/site-content";

const publicRoutes = [
  { path: "", priority: 1, changeFrequency: "monthly" as const },
  { path: "/new-construction", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/retrofit", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/products", priority: 0.7, changeFrequency: "monthly" as const },
  { path: "/about", priority: 0.6, changeFrequency: "yearly" as const },
  { path: "/contact", priority: 0.6, changeFrequency: "yearly" as const },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return publicRoutes.map((route) => ({
    url: `${siteMeta.siteUrl}${route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
