import type { NextConfig } from "next";
import { readEnvironment } from "./lib/env";

readEnvironment();

const nextConfig: NextConfig = {};

export default nextConfig;
