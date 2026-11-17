# 🪙 Dompet Pro (DompetSaya)

> Aplikasi keuangan pribadi berbasis Progressive Web App (PWA) yang ringan, responsif, dan cerdas, dirancang khusus untuk mengelola anggaran, pengeluaran harian, dan target tabungan mahasiswa secara akurat.

[![GitHub Pages](https://img.shields.io/badge/Status-Online-emerald?style=flat-square)](https://412dhan.github.io/DompetSaya/)
[![PWA Ready](https://img.shields.io/badge/PWA-Supported-indigo?style=flat-square)](https://web.dev/progressive-web-apps/)
[![Tailwind CSS](https://img.shields.io/badge/Styling-TailwindCSS-blue?style=flat-square)](https://tailwindcss.com/)

---

## 📖 Tentang Proyek

**Dompet Pro** adalah solusi manajemen keuangan pribadi minimalis tanpa backend yang berat (*client-side web app*). Aplikasi ini memanfaatkan penyimpanan lokal browser (`localStorage`) dan mendukung fitur *offline-first* melalui Service Worker. 

Sistem penganggaran di dalam aplikasi ini telah dioptimalkan khusus untuk pola keuangan mahasiswa (misalnya pengelolaan uang saku bulanan/mingguan, alokasi bensin, biaya makan di kampus, kuota internet, hingga target tabungan jangka panjang).

---

## ✨ Fitur Utama

*   📊 **Dashboard Keuangan:** Ringkasan real-time total pemasukan, pengeluaran, dan sisa saldo dalam bulan berjalan.
*   🍔 **Manajemen Anggaran (Budgeting):** Kategori pengeluaran fleksibel (Bensin, Makan Kampus, Kuota Internet, dll) dilengkapi indikator *progress bar* visual untuk mencegah *over-budget*.
*   🎯 **Tujuan Tabungan (Savings Goals):** Fitur untuk mencatat target finansial (seperti membeli perangkat atau dana darurat) lengkap dengan tombol penambahan dana interaktif.
*   📈 **Laporan & Grafik Visual:** Diagram lingkaran (*doughnut chart*) interaktif menggunakan **Chart.js** untuk memetakan persentase pengeluaran berdasarkan kategori.
*   ✨ **Analisis AI Pintar:** Integrasi dengan **Gemini API** untuk menghasilkan analisis pola pengeluaran mingguan dan tips hemat otomatis.
*   🔒 **Keamanan PIN:** Fitur kunci aplikasi menggunakan 4 digit PIN untuk menjaga privasi data finansial pengguna.
*   🌙 **Mode Gelap (Dark Mode):** Kenyamanan visual optimal untuk penggunaan siang dan malam hari.
*   📱 **Dukungan PWA:** Dapat diinstal langsung ke layar utama (*home screen*) perangkat seluler layaknya aplikasi native.

---

## 🛠️ Tech Stack

*   **Frontend:** HTML5, Vanilla JavaScript (ES6+), Inter Font
*   **Styling:** Tailwind CSS (via CDN)
*   **Visualisasi Data:** Chart.js (v3.9.1)
*   **Penyimpanan Data:** Browser Local Storage
*   **Deployment:** GitHub Pages

---

## 🗂️ Struktur Direktori

```text
DompetSaya/
├── index.html          # Halaman utama SPA (Single Page Application) & Logika Core JS
├── manifest.json       # Konfigurasi Progressive Web App (PWA)
├── sw.js               # Service Worker untuk caching & akses offline
└── icons/              # Aset ikon aplikasi (192x192 & 512x512)
