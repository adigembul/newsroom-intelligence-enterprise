# Newsroom Intelligence Enterprise v6.4

Patch lengkap: AI Insight/AI Tools branding, monitoring button state, audience-insights style report graph, responsive layout precision, and improved print-ready reporting.


## v6.5 Geographic Scoped Search + Deploy Ready

Fitur baru:
- Pencarian spesifik berdasarkan benua, kawasan Asia, ASEAN, Middle East, GCC, negara, dan kota.
- Quick preset: Indonesia, ASEAN, Middle East, Asia, Jakarta, Singapore, Dubai.
- Mode pencarian: cepat, standar, dan deep scan.
- Query sumber otomatis diperkuat dengan wilayah, tetapi audit relevansi tetap memakai keyword utama agar hasil tidak melebar.
- Siap deploy ke GitHub dan Vercel: sudah ada `vercel.json`, `.env.example`, dan `.gitignore`.

### Jalankan Lokal
```bash
npm install
cp .env.example .env
npm start
```
Buka `http://localhost:3000`.

### Deploy Vercel CLI
```bash
npm install
npx vercel --prod
```

### Upload GitHub
```bash
git init
git add .
git commit -m "release v6.5 geographic search"
git branch -M main
git remote add origin https://github.com/USERNAME/newsroom-intelligence-enterprise.git
git push -u origin main
```


## v6.9 Robust Monitoring + Clickable PDF Links
- Start Monitoring, Stop, and Reset Data flow hardened with run-id guard so old scan results are ignored after stop/reset.
- Added realtime status strip: status, mode, region, and data count.
- PDF export includes clickable documentation link pages and visible metrics: views, likes, comments, shares, viral score.
- PDF link annotations are used so blue source links open the original source in compatible PDF viewers.


## v6.9 Reliability Patch
- API key AI Tools dapat ditempel dan disimpan tanpa field terkunci; Test AI tetap meminta verifikasi superadmin.
- Start Monitoring, Stop, dan Reset Data memakai direct binding + delegated fallback agar tetap aktif meski ada modul lain error.
- Apify tidak lagi memblokir scan jika Dataset ID kosong; sumber lain tetap jalan.
- UI kontrol monitoring dan settings dibuat responsive, tidak terpotong di desktop/mobile.
- PDF report tetap memakai clickable link annotation dan menampilkan mention, views, likes, comments, shares, dan viral score.


## v6.9 Poppins Typography
- Seluruh UI aplikasi memakai font Poppins dengan fallback system font.
- Report HTML memakai Poppins dan detail typography yang lebih tajam.
- Canvas chart memakai Poppins untuk label kecil agar lebih jelas.
- PDF report memakai layout Poppins-style dan link interaktif tetap dipertahankan.


## v7.0 Robust AI Generate & Enterprise Buttons
- AI Generate Rilis/Rewrite/SEO/AEO/GEO memakai timeout lebih panjang agar tidak abort saat model lambat.
- Jika API eksternal timeout, content optimizer menghasilkan fallback editorial lokal berbasis data monitoring.
- Tombol Start/Stop/Reset, Test AI, dan Generate AI dibuat simetris, presisi, dan responsive.
- Tambahkan `AI_REQUEST_TIMEOUT_MS=90000` di Vercel Environment Variables untuk produksi.

## Patch v7.1 - Fix Deploy Vercel npm install error

Jika Vercel menampilkan error:

```bash
npm error Exit handler never called!
Error: Command "npm install" exited with 1
```

Gunakan patch v7.1 ini. Perubahan yang sudah diterapkan:

- `package-lock.json` lama dihapus karena sebelumnya membawa metadata registry internal dan nama versi lama.
- `vercel.json` memakai `pnpm` via Corepack agar tidak terkena bug npm install di build Vercel.
- `package.json` dipin ke Node 20 dan `pnpm@9.15.4`.
- `server.js` sudah `export default app` dan `server.listen()` hanya berjalan lokal, bukan di Vercel serverless.

### Cara update repository GitHub dari patch v7.1

```bash
# dari folder project v7.1
git rm -f package-lock.json 2>nul || del package-lock.json
git add .
git commit -m "fix vercel deploy with pnpm and serverless export"
git push
```

Di Vercel, set **Install Command** kosong atau biarkan mengikuti `vercel.json`. Build akan memakai:

```bash
corepack enable && pnpm install --no-frozen-lockfile
```

Setelah push, lakukan **Redeploy** dari dashboard Vercel.

