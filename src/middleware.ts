import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  // Protect everything except the NextAuth API route and static assets.
  // PWA installability: browsers fetch manifest.webmanifest and the icon
  // metadata routes WITHOUT cookies — if auth intercepts them they get a
  // login redirect (HTML) instead of the manifest/PNG, and Chrome silently
  // drops the "Add to Home Screen" eligibility. They must stay public:
  // the manifest and icons carry no user data.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest$|icon$|icon-192$|apple-icon$|sw\\.js$|offline$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest|js|css|woff2?)$).*)",
  ],
};
