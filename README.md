# SSP

Standalone Selco Solution Portal supplier directory.

Project folder:
`C:\github\selco-vendor-directory`

Included app surfaces:
- Public search page: `index.html`
- Vendor detail page: `vendor-detail.html`
- Admin-triggered sync page: `admin.html`
- Shared Supabase loader: `selco-vendor-store.js`
- Supabase migration: `supabase/migrations/20260424180000_create_selco_vendor_directory.sql`
- Supabase edge function: `supabase/functions/selco-vendor-admin/index.ts`

Deployment:
- GitHub Pages deploys automatically from `.github/workflows/deploy-pages.yml`
- GitHub repository: `https://github.com/tanmaymukherji/SSP`
- Live site: `https://tanmaymukherji.github.io/SSP/`
- The static frontend uses the configured Supabase URL and anon key in `config.js`
- Add a `MAPMYINDIA_MAP_KEY` in `config.js` to enable the live map

Backend requirement:
- Set the `SELCO_VENDOR_SERVICE_ROLE_KEY` secret for the `selco-vendor-admin` edge function before running admin syncs
