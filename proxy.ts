import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware(async (auth, request) => {
  const path = request.nextUrl.pathname;
  const isAuthPage = ["/sign-in", "/sign-up"].some(route => path === route || path.startsWith(`${route}/`));
  if (isAuthPage) return;

  const { userId } = await auth();
  if (path.startsWith("/api/")) {
    if (!userId) return Response.json({ error: "Authentication required." }, { status: 401 });
    return;
  }
  if (!userId) await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
