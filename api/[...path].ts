import { handleCasinobyHackyApi } from "../src/api.js";

/** Vercel function for /api/* (public URL: /casinobyhacky/api/*, see vercel.json). */
export const GET = (request: Request) => handleCasinobyHackyApi(request);
export const POST = (request: Request) => handleCasinobyHackyApi(request);
export const PUT = (request: Request) => handleCasinobyHackyApi(request);
