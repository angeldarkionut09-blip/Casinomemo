import { handleCitelyApi } from "../src/api.js";

/** Vercel function for /api/* (public URL: /citely/api/*, see vercel.json). */
export const GET = (request: Request) => handleCitelyApi(request);
export const POST = (request: Request) => handleCitelyApi(request);
export const PUT = (request: Request) => handleCitelyApi(request);
