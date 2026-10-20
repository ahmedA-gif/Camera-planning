import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware(async (auth, request) => {
  const path = request.nextUrl.pathname;
  const isAuthPage = ["/sign-in", "/sign-up"].some(route => path === route || path.startsWith(`${route}/`));
  if (isAuthPage) return;

  // Let API requests pass through without 401 errors
  if (path.startsWith("/api/")) return;

  try {
    // Attempt authentication check without throwing 404 rewrite
    const session = await auth();
    // Continue smoothly
  } catch {
    // Graceful fallback
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
