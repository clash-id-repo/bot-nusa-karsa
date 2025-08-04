// ======================================================
// INISIALISASI & IMPORT LIBRARY
// ======================================================
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage, isJidGroup } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode'); 
const fs = require('fs');
const axios = require('axios');
const express = require('express');
const { DateTime } = require('luxon');
require('dotenv').config();

// ======================================================
// KONFIGURASI & VARIABEL GLOBAL
// ======================================================
console.log('[ENV] OWNER_NUMBER dimuat:', process.env.OWNER_NUMBER);
const OWNER_NUMBER = process.env.OWNER_NUMBER || 'gantinomormu';
const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY || 'ganti_kunci_server_midtrans';
const FERDEV_API_KEY = "key-arh";
const BOT_VERSION = "3.2 - Beta";

let botJid = '';
let sock = null; 
let userState = {};
let greetedUsers = new Set();
let userActivity = {};
const botStartTime = DateTime.now().setZone('Asia/Jakarta');

// Konfigurasi Anti-Spam & Anti-Telepon
const SPAM_MESSAGE_LIMIT = 7; 
const SPAM_TIME_LIMIT = 4000; 
const CALL_COOLDOWN_SECONDS = 10; 
let callHistory = new Map();

// Path file data
const dataDir = './data';
const productsFilePath = `${dataDir}/products.json`;
const stockFilePath = `${dataDir}/stock.json`;
const transactionsFilePath = `${dataDir}/transactions.json`;
const usersFilePath = `${dataDir}/users.json`;
const blockedFilePath = `${dataDir}/blocked.json`;

// ======================================================
// TEKS PANDUAN & OWNER
// ======================================================
const PANDUAN_TEXT = `*❓ PANDUAN MEMBELI PRODUK DI NUSA KARSA*

Selamat datang di NUSA KARSA! 👋
NUSA KARSA adalah platform toko digital yang menyediakan berbagai produk digital yang bisa kamu beli secara otomatis melalui bot auto order WhatsApp ini. Kami menawarkan kemudahan dan kecepatan dalam mendapatkan produk digital yang kamu butuhkan.

⭐️ *Keuntungan pesan di Bot kami?*
> ✅ Tanpa biaya layanan tambahan.
> ✅ Pesanan diproses otomatis 24/7.
> ✅ Pengiriman produk instan setelah pembayaran.
> ✅ Stok produk selalu update secara real-time.

📌 *Syarat Pembelian*
> 1. Memiliki aplikasi E-Wallet (GoPay, OVO, DANA, dll) atau Mobile Banking yang mendukung pembayaran via *QRIS*.
> 2. Nomor WhatsApp Kamu aktif untuk menerima detail produk.
> 3. Siap menyelesaikan pembayaran sebelum QRIS kedaluwarsa (*5 menit*).

📖 *Tutorial Lengkap Pembelian*
> *Langkah 1: Lihat Katalog*
> Ketik perintah \`/katalog\` untuk melihat daftar produk. Bot akan membalas dengan daftar produk yang diberi nomor.

> *Langkah 2: Lihat Detail Produk*
> Balas pesan katalog dengan mengetik *nomor produk* yang Kamu inginkan (misal: \`1\`). Bot akan menampilkan detail lengkap, termasuk variasi produk dan kodenya.
 
> *Langkah 3: Lakukan Pembelian*
> Setelah melihat detail, ketik perintah \`/beli\` diikuti dengan *KODE VARIAN* unik dan jumlah.
> > Contoh: \`/beli CANVA-EDU 1\`
 
> *Langkah 4: Konfirmasi Pesanan*
> Bot akan memberikan rincian pesanan Kamu. Baca dengan teliti, lalu balas dengan \`YA\` untuk melanjutkan ke pembayaran, atau \`BATAL\` jika tidak jadi.
 
> *Langkah 5: Lakukan Pembayaran*
> Scan QRIS yang dikirim oleh bot menggunakan aplikasi pembayaran Kamu. Pastikan Kamu membayar dalam waktu kurang dari 5 menit.
 
> *Langkah 6: Terima Produk Kamu!*
> Setelah pembayaran berhasil terdeteksi, bot akan *otomatis* mengirimkan detail produk ke chat Kamu.

*Butuh Bantuan Lain?*
> Jika Kamu masih bingung, jangan ragu untuk bertanya pada Customer Service AI kami dengan perintah:
> \`/cs\`

❕ *Catatan Penting*
> 1. Semua transaksi bersifat final. Kesalahan input oleh pengguna bukan merupakan tanggung jawab kami.
> 2. Harap segera amankan detail akun/produk yang Kamu terima setelah transaksi berhasil.
> 3. Jika terjadi masalah serius, segera hubungi Owner dengan perintah \`/owner\`.
`;
const OWNER_TEXT = `*👨‍💻 INFORMASI OWNER*\n\nJika Kamu menemukan kendala, bug, atau memiliki pertanyaan bisnis, silakan hubungi kami.\n\n> *📞 Nomor WhatsApp:* wa.me/${OWNER_NUMBER}\n> *Catatan:* Mohon untuk chat saja dan jelaskan keperluan Kamu dengan jelas.`;

// ======================================================
// FUNGSI PEMUATAN & PENYIMPANAN DATA
// ======================================================
function ensureDbFolderExists() {
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
        console.log(`[SETUP] Folder '${dataDir}' berhasil dibuat.`);
    }
}

function loadData(filePath, defaultValue) {
    try {
        if (fs.existsSync(filePath)) { return JSON.parse(fs.readFileSync(filePath)); }
        fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
        return defaultValue;
    } catch (e) {
        console.error(`Gagal memuat atau membuat file ${filePath}:`, e);
        return defaultValue;
    }
}
function saveData(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ======================================================
// FUNGSI HELPER
// ======================================================
function promiseWithTimeout(promise, ms) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`Proses melebihi batas waktu ${ms} ms`));
        }, ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

function getDynamicGreeting() {
    const now = DateTime.now().setZone('Asia/Jakarta');
    const serverTime = now.toFormat("cccc, dd LLLL yyyy HH:mm:ss 'WIB GMT +7'");
    const hour = now.hour;
    let greeting = "", emoji = "";
    if (hour >= 4 && hour < 10) { greeting = "Selamat pagi"; emoji = "☀️"; }
    else if (hour >= 10 && hour < 15) { greeting = "Selamat siang"; emoji = "🌤️"; }
    else if (hour >= 15 && hour < 18) { greeting = "Selamat sore"; emoji = "🌇"; }
    else { greeting = "Selamat malam"; emoji = "🌙"; }
    return { greeting, emoji, serverTime };
}

function formatUptime(startTime) {
    const now = DateTime.now().setZone('Asia/Jakarta');
    const diff = now.diff(startTime, ['days', 'hours', 'minutes', 'seconds']).toObject();
    return `${Math.floor(diff.days)} Hari ${Math.floor(diff.hours)} Jam ${Math.floor(diff.minutes)} Menit ${Math.floor(diff.seconds)} Detik`;
}

// --- PERBAIKAN 1 DIMULAI DI SINI ---
// Mengganti header menjadi lebih profesional dan stabil
function createHeaderQuote(from) {
    return {
        key: {
            remoteJid: from,
            fromMe: true, // Mengindikasikan pesan ini dari bot itu sendiri
            id: 'NUSA_KARSA_HEADER',
            participant: botJid // JID dari bot
        },
        message: {
            // Teks yang statis dan profesional untuk header
            conversation: `*NUSA KARSA*\nSERVER TIME : ${getDynamicGreeting().serverTime}`
        }
    };
}
// --- AKHIR PERBAIKAN 1 ---

async function sendFormattedMessage(jid, text, extraOptions = {}) {
    const footer = "\n\n> © NUSA KARSA";
    const finalMessage = {
        text: text + footer,
        ...extraOptions
    };
    return sock.sendMessage(jid, finalMessage, { quoted: createHeaderQuote(jid) });
}

const CS_CONSTITUTION = `Kamu adalah "CS Karsa", asisten Customer Service (CS) AI yang profesional dan ramah untuk toko digital "NUSA KARSA". Tugas utama Kamu adalah menjawab segala pertanyaan pengguna seputar produk, cara pembelian, dan cara penggunaan bot NUSA KARSA tapi juga memiliki pengetahuan umum lainnya, apapun pertanyaan nya kamu tau dan tetap mengarahkan ke penggunaan bot dan Kamu tau dalam segala hal.
**--- PENGETAHUAN WAJIB Kamu ---**
* **Tujuan Toko:** Menjual produk digital secara otomatis via bot WhatsApp.
* **Perintah Utama:**
    * \`/katalog\` atau \`/menu\`: Menampilkan daftar produk. Pengguna harus membalas dengan nomor untuk melihat detail.
    * \`/beli <KODE_VARIAN>\`: Perintah untuk membeli sebuah variasi produk. Kode ini didapat dari detail produk.
    * \`/riwayat\`: Untuk pengguna melihat riwayat transaksi mereka yang sudah berhasil.
    * \`/panduan\`: Menampilkan panduan lengkap cara berbelanja dari awal sampai akhir.
    * \`/produkpopuler\`: Menunjukkan 5 produk yang paling banyak dibeli.
    * \`/info\`: Menampilkan statistik untuk pengguna dan bot.
    * \`/owner\`: Menampilkan kontak pemilik bot jika ada masalah serius.
**--- ATURAN PERILAKU ---**
1.  **FOKUS:** Selalu fokus pada konteks NUSA KARSA. Jangan menjawab pertanyaan di luar topik seperti cuaca, berita, atau pengetahuan umum yang tidak relevan, boleh jawab tapi tetap kembali mengarahkan ke tujuan utama bot yaitu toko digital NUSA KARSA dan pastikan produk yang dijual sesuai dengan toko digital nusa karsa, baik nama sampai varian produk nya.
2.  **RAMAH & PROFESIONAL:** Gunakan bahasa Indonesia yang baik, sopan, dan mudah dimengerti. Sapa pengguna dengan ramah, gunakan sapaan Kamu bukan Anda.
3.  **MENGARAHKAN, BUKAN MELAKUKAN:** Jika pengguna bertanya "bagaimana cara beli?", jelaskan langkah-langkahnya dan suruh mereka menggunakan perintah \`/beli\`. JANGAN mencoba memproses pembelian.
4.  **TOLAK DENGAN SOPAN:** Jika pertanyaan benar-benar di luar topik, tolak dengan sopan. Contoh: "Mohon maaf, sebagai CS NUSA KARSA, saya hanya bisa membantu menjawab pertanyaan seputar produk dan layanan kami. Ada lagi yang bisa saya bantu terkait toko kami?"
5.  **GUNAKAN FORMAT:** Gunakan format \`monospace\` untuk perintah (contoh: \`/katalog\`) dan format *italic* atau **bold** untuk penekanan.
6.  **JANGAN MENGARANG:** Jika Kamu tidak tahu jawabannya, lebih baik sarankan pengguna untuk bertanya kepada \`/owner\`.
`;

async function askCS(question) {
    if (!FERDEV_API_KEY) return "Maaf, layanan Customer Service AI sedang tidak aktif saat ini.";
    const finalPrompt = `${CS_CONSTITUTION}\n\nPertanyaan Pengguna: "${question}"`;
    const url = `https://api.ferdev.my.id/ai/gemini?prompt=${encodeURIComponent(finalPrompt)}&apikey=${FERDEV_API_KEY}`;
    try {
        const response = await axios.get(url);
        if (response.data && response.data.message) {
            return response.data.message;
        } else {
            console.error("Respon tidak valid dari Ferdev API:", response.data);
            return "Maaf, saya sedang kesulitan memproses permintaan Kamu. Coba lagi beberapa saat.";
        }
    } catch (error) {
        console.error("FERDEV API ERROR:", error.message);
        return "Maaf, terjadi gangguan pada layanan Customer Service AI kami. Silakan coba lagi nanti.";
    }
}

function generateMenuText(isOwner) {
    let text = `*MENU UTAMA*\n`;
    text += `> \`/katalog\` - Melihat semua produk.\n`;
    text += `> \`/produkpopuler\` - Melihat 5 produk terlaris.\n\n`;
    text += `*BANTUAN & INFO*\n`;
    text += `> \`/menu\` - Melihat semua perintah.\n`;
    text += `> \`/panduan\` - Cara lengkap membeli produk.\n`;
    text += `> \`/riwayat\` - Melihat riwayat transaksimu.\n`;
    text += `> \`/info\` - Cek info & statistik bot.\n`;
    text += `> \`/cs\` - Tanya langsung ke Customer Service AI.\n`;
    text += `> \`/owner\` - Hubungi pemilik bot.\n`;
    if (isOwner) {
        text += `\n*MENU OWNER*\n`;
        text += `> \`/tambahproduk\` - Tambah produk/varian.\n`;
        text += `> \`/editproduk\` - Edit nama/deskripsi produk.\n`;
        text += `> \`/hapusproduk\` - Hapus produk.\n`;
        text += `> \`/hapusvarian\` - Hapus varian.\n`;
        text += `> \`/tambahstok\` - Tambah stok varian.\n`;
        text += `> \`/cekstok\` - Lihat semua stok.\n`;
        text += `> \`/statistik\` - Lihat statistik penjualan.\n`;
        text += `> \`/settotalsold\` - Atur total terjual.\n`;
        text += `> \`/unblock\` - Buka blokir pengguna.\n`;
        text += `> \`/broadcast\` - Kirim pesan siaran.\n`;
        text += `> \`/debugowner\` - Cek info debug owner.\n`;
    }
    return text;
}

// ======================================================
// FUNGSI UTAMA BOT
// ======================================================
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    sock = makeWASocket({ 
        logger: pino({ level: 'silent' }), 
        auth: state, 
        browser: ['Nusa Karsa', 'Chrome', '3.2.0'] 
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('------------------------------------------------');
            console.log('    QR DITERIMA! SILAKAN AKSES URL RENDER KAMU    ');
            console.log('------------------------------------------------');
            qrcode.toFile('qr.png', qr, (err) => {
                if (err) {
                    console.error('❌ Gagal menyimpan file QR:', err);
                } else {
                    console.log('✅ QR Code berhasil disimpan sebagai qr.png.');
                    console.log('   Buka alamat web bot Anda + /qr untuk scan.');
                    console.log('------------------------------------------------');
                }
            });
        }

        if (connection === 'close') {
            if (fs.existsSync('qr.png')) {
                fs.unlinkSync('qr.png');
            }
            
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('🔴 Koneksi terputus karena:', lastDisconnect.error, ', menyambungkan kembali:', shouldReconnect);
            
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            botJid = sock.user.id;
            greetedUsers.clear(); 
            console.log('✨ Bot Nusa Karsa berhasil tersambung!');
        }
    });

    // --- SEMUA EVENT HANDLER LAINNYA HARUS DI DALAM FUNGSI INI ---

    sock.ev.on('call', async (calls) => {
        for (const call of calls) {
            if (call.status === 'offer') {
                const callerJid = call.from;
                const now = Math.floor(Date.now() / 1000);
                if (callHistory.has(callerJid) && (now - callHistory.get(callerJid) < CALL_COOLDOWN_SECONDS)) {
                    await sock.rejectCall(call.id, callerJid);
                    continue;
                }
                callHistory.set(callerJid, now);
                await sock.rejectCall(call.id, callerJid);
                await sock.sendMessage(callerJid, { text: "⚠️ *Panggilan Ditolak.*\n\nMohon maaf, saya adalah bot otomatis dan tidak dapat menerima panggilan. Keperluan hanya melalui chat teks. Terima kasih." });
                await sock.updateBlockStatus(callerJid, "block");
                let blocked = loadData(blockedFilePath, []);
                if (!blocked.includes(callerJid)) {
                    blocked.push(callerJid);
                    saveData(blockedFilePath, blocked);
                }
                await sock.sendMessage(`${OWNER_NUMBER}@s.whatsapp.net`, { text: `🚨 *Peringatan Keamanan* 🚨\n\nPengguna @${callerJid.split('@')[0]} telah menelepon bot dan diblokir secara otomatis.`, mentions: [callerJid] });
            }
        }
    });

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        let reactionEmoji = '';
        const from = msg.key.remoteJid;
        const senderId = from.endsWith('@g.us') ? msg.key.participant : from;
        
        try {
            const ownerJid = `${OWNER_NUMBER}@s.whatsapp.net`;
            if (senderId !== ownerJid) {
                let blocked = loadData(blockedFilePath, []);
                if (blocked.includes(senderId)) return;
                
                const now = Date.now();
                if (!userActivity[senderId]) userActivity[senderId] = { timestamps: [] };
                userActivity[senderId].timestamps.push(now);
                userActivity[senderId].timestamps = userActivity[senderId].timestamps.filter(ts => now - ts < SPAM_TIME_LIMIT);

                if (userActivity[senderId].timestamps.length > SPAM_MESSAGE_LIMIT) {
                    if (!blocked.includes(senderId)) {
                        await sock.sendMessage(from, { text: "‼️ *PERINGATAN SPAM* ‼️\n\nKamu terdeteksi melakukan spam. Nomor Kamu akan diblokir secara otomatis. Hubungi Owner jika ini adalah kesalahan." });
                        await sock.updateBlockStatus(senderId, "block");
                        blocked.push(senderId);
                        saveData(blockedFilePath, blocked);
                        await sock.sendMessage(ownerJid, { text: `🚫 *Pengguna Diblokir (Spam)* 🚫\n\nPengguna @${senderId.split('@')[0]} telah diblokir karena melakukan spam.`, mentions: [senderId] });
                    }
                    return;
                }
            }
            
            const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || msg.message?.videoMessage?.caption || "";
            if(!body) return;
            
            const userName = msg.pushName || "Pelanggan";

            const users = loadData(usersFilePath, {});
            if (!users[senderId]) {
                users[senderId] = { name: userName, transactions: [] };
                saveData(usersFilePath, users);
            } else if (users[senderId].name !== userName) {
                users[senderId].name = userName;
                saveData(usersFilePath, users);
            }

            const prefix = '/';
            const isCmd = body.trim().startsWith(prefix);

            if (userState[senderId] && !isCmd) {
                const currentStateData = userState[senderId];
                const lowerBody = body.toLowerCase();

                if (currentStateData.state === 'awaiting_catalog_choice') {
                    if (['selesai', 'keluar', 'batal'].includes(lowerBody)) {
                        delete userState[senderId];
                        reactionEmoji = '👍';
                        return await sendFormattedMessage(from, "Oke, Kamu telah keluar dari mode katalog.");
                    }
                    const choice = parseInt(body);
                    const products = currentStateData.displayedProducts; 
                    if (!isNaN(choice) && choice > 0 && choice <= products.length) {
                        const product = products[choice - 1];
                        const stock = loadData(stockFilePath, {});
                        
                        let detailMessage = `*📄 DETAIL PRODUK*\n`;
                        detailMessage += `> *Produk:* ${product.name}\n`;
                        detailMessage += `> *Total Terjual:* ${product.totalSold || 0}\n`;
                        detailMessage += `> *Deskripsi:* ${product.description || 'Tidak ada deskripsi.'}\n`;
                        detailMessage += `> S&K: \`/panduan\`\n\n`;
                        detailMessage += `*VARIASI, HARGA & STOK:*\n`;

                        product.variations.forEach(v => {
                            const variationCode = `${product.id}-${v.code}`;
                            const stockCount = stock[variationCode.toUpperCase()] ? stock[variationCode.toUpperCase()].length : 0;
                            detailMessage += `> Kode Varian: \`${variationCode}\` \n> Type: \`${v.name}\` \n> Harga: Rp ${v.price.toLocaleString('id-ID')} \n> Stok: *${stockCount}*\n`;
                        });
                        
                        const refreshTime = DateTime.now().setZone('Asia/Jakarta').toFormat('HH.mm.ss');
                        detailMessage += `\n╰➤ Refresh stock at ${refreshTime} WIB\n\n`;
                        detailMessage += `Untuk membeli, ketik \`/beli\` diikuti Kode Varian dan jumlah yang ingin dibeli.\nContoh: \`/beli ${product.id}-${product.variations[0].code} 1\``;

                        await sendFormattedMessage(from, detailMessage);
                        reactionEmoji = '📄';
                    } else {
                        await sendFormattedMessage(from, "Pilihan tidak valid. Silakan masukkan nomor produk yang benar, atau ketik `selesai` untuk keluar.");
                        reactionEmoji = '❓';
                    }
                    return; 
                }

                if (currentStateData.state === 'awaiting_purchase_confirmation') {
                    clearTimeout(currentStateData.timeoutId);
                    if (lowerBody === 'ya') {
                        const { variationCode, quantity } = currentStateData;
                        const products = loadData(productsFilePath, []);
                        let product;
                        let variation;
                        for(const p of products){
                            const v = p.variations.find(v => `${p.id}-${v.code}`.toLowerCase() === variationCode.toLowerCase());
                            if(v){ product = p; variation = v; break; }
                        }

                        const totalPrice = variation.price * quantity;
                        const orderId = `NK-${senderId.split('@')[0]}-${Date.now()}`;
                        
                        const transactionDetails = {
                            transaction_details: { order_id: orderId, gross_amount: totalPrice },
                            payment_type: "qris",
                            custom_expiry: { expiry_duration: 5, unit: "minute" },
                            customer_details: { first_name: userName, phone: senderId.split('@')[0] }
                        };

                        await sendFormattedMessage(from, "⏳ Sedang membuat tagihan QRIS, mohon tunggu...");

                        let midtransResponse;
                        try {
                            let attempts = 0;
                            const maxAttempts = 3;
                            while (attempts < maxAttempts) {
                                try {
                                    attempts++;
                                    const axiosPromise = axios.post('https://api.sandbox.midtrans.com/v2/charge', transactionDetails, {
                                        headers: { 'Authorization': 'Basic ' + Buffer.from(MIDTRANS_SERVER_KEY).toString('base64'), 'Content-Type': 'application/json', 'Accept': 'application/json' }
                                    });
                                    midtransResponse = await promiseWithTimeout(axiosPromise, 15000);
                                    break; 
                                } catch (error) {
                                    console.error(`[Midtrans] Percobaan ke-${attempts} gagal:`, error.message);
                                    if (attempts >= maxAttempts) throw error;
                                    await new Promise(resolve => setTimeout(resolve, 2000));
                                }
                            }
                        } catch (error) {
                            console.error("[ERROR UTAMA] Gagal membuat transaksi Midtrans:", error);
                            reactionEmoji = '❌';
                            delete userState[senderId];
                            await sendFormattedMessage(from, "Maaf, terjadi kesalahan saat menghubungi server pembayaran. Silakan coba lagi nanti.");
                            return;
                        }

                        const qrCodeUrl = midtransResponse.data.actions.find(a => a.name === 'generate-qr-code').url;
                        const transactions = loadData(transactionsFilePath, {});
                        
                        // --- PERBAIKAN BUG `variationCode` DIMULAI DI SINI ---
                        transactions[orderId] = { 
                            userId: senderId, 
                            productId: product.id, 
                            variationCode: variationCode, // Menggunakan `variationCode` lengkap (misal: "CANVA-EDU")
                            productName: `${product.name} - ${variation.name}`, 
                            quantity: quantity, 
                            status: "PENDING", 
                            createdAt: new Date().toISOString() 
                        };
                        // --- AKHIR PERBAIKAN BUG ---
                        
                        saveData(transactionsFilePath, transactions);

                        // --- PERBAIKAN 2A (SIMPAN KUNCI) DIMULAI DI SINI ---
                        const caption = `*🧾 TAGIHAN PEMBAYARAN*\n\nSilakan scan QRIS di atas untuk membayar pesanan\nID: \`${orderId}\`. Produk akan otomatis dikirim setelah pembayaran berhasil.\n\n*PERHATIAN:* Link pembayaran ini akan kedaluwarsa dalam *5 menit*.`;
                        const sentQRMessage = await sock.sendMessage(from, { image: { url: qrCodeUrl }, caption: caption });
                        
                        // Simpan kunci pesan ke dalam data transaksi
                        transactions[orderId].messageKey = sentQRMessage.key;
                        saveData(transactionsFilePath, transactions); // Simpan lagi setelah menambahkan kunci
                        // --- AKHIR PERBAIKAN 2A ---
                        
                        setTimeout(async () => {
                            const currentTransactions = loadData(transactionsFilePath, {});
                            if (currentTransactions[orderId] && currentTransactions[orderId].status === 'PENDING') {
                                // Hanya hapus pesan jika masih pending dan belum ada kunci (artinya belum dihapus oleh webhook)
                                if (currentTransactions[orderId].messageKey) {
                                    await sock.sendMessage(from, { delete: currentTransactions[orderId].messageKey });
                                }
                                await sendFormattedMessage(from, `⌛ *WAKTU PEMBAYARAN HABIS*\n\nPembayaran untuk pesanan \`${orderId}\` telah kedaluwarsa dan dibatalkan.`);
                                delete currentTransactions[orderId];
                                saveData(transactionsFilePath, currentTransactions);
                            }
                        }, 305000); // 5 menit 5 detik
                        reactionEmoji = '⏳';
                        
                    } else if (lowerBody === 'batal') {
                        await sendFormattedMessage(from, "Baik, pesanan telah dibatalkan.");
                        reactionEmoji = '👍';
                    } else {
                        await sendFormattedMessage(from, "Pilihan tidak valid. Silakan balas dengan `YA` atau `BATAL`.");
                        return;
                    }
                    delete userState[senderId];
                }
                return;
            }

            if (userState[senderId] && isCmd) {
                console.log(`[State] Pengguna ${senderId} keluar dari state '${userState[senderId].state}' karena ada perintah baru.`);
                if(userState[senderId].timeoutId) clearTimeout(userState[senderId].timeoutId);
                delete userState[senderId];
            }

            if (isCmd) {
                const command = body.trim().split(/ +/)[0].toLowerCase();
                const args = body.trim().split(/ +/).slice(1);
                const ownerJid = `${OWNER_NUMBER}@s.whatsapp.net`;
                
                switch (command) {
                    case '/menu':
                    case '/help': {
                        const menuText = generateMenuText(senderId === ownerJid);
                        await sendFormattedMessage(from, menuText);
                        reactionEmoji = '📋';
                        break;
                    }
                    case '/katalog':
                    case '/produk': {
                        const products = loadData(productsFilePath, []);
                        const itemsPerPage = 10;
                        const page = parseInt(args[0]) || 1;
                        const totalPages = Math.ceil(products.length / itemsPerPage) || 1;
                        if (page < 1 || page > totalPages) {
                             await sendFormattedMessage(from, `Halaman tidak ditemukan. Hanya ada ${totalPages} halaman.`);
                             reactionEmoji = '🤷';
                             break;
                        }
                        const startIndex = (page - 1) * itemsPerPage;
                        const productsOnPage = products.slice(startIndex, startIndex + itemsPerPage);
                        let catalogMessage = `*LIST PRODUK*\n`;
                        catalogMessage += `┊  Page ${page} / ${totalPages}\n`;
                        catalogMessage += `┊- - - - - - - - - - - - - - - - - - \n`;
                        if (productsOnPage.length === 0) {
                            catalogMessage = "Maaf, belum ada produk yang tersedia.";
                        } else {
                            productsOnPage.forEach((product, index) => {
                                catalogMessage += `┊ [${startIndex + index + 1}] ${product.name}\n`;
                            });
                            catalogMessage += `╰\n\n`;
                            catalogMessage += `(Balas dengan *nomor* untuk melihat detail produk)\n\n`;
                            if (page < totalPages) catalogMessage += `(Ketik \`/katalog ${page + 1}\` untuk halaman selanjutnya)\n\n`;
                            catalogMessage += `*Shortcut Menu:*\n`;
                            catalogMessage += `> \`/katalog\`, \`/beli\`, \`/riwayat\`, \`/panduan\``;
                            userState[senderId] = { state: 'awaiting_catalog_choice', displayedProducts: products };
                        }
                        await sendFormattedMessage(from, catalogMessage);
                        reactionEmoji = '🛍️';
                        break;
                    }
                    case '/beli': {
                        const variationCode = args[0];
                        const quantity = parseInt(args[1]) || 1;

                        if (!variationCode) {
                            await sendFormattedMessage(from, "Format salah. Gunakan `/beli <KODE_VARIAN>`.\n\n> Kamu bisa mendapatkan Kode Varian setelah melihat detail produk dari /katalog.");
                            reactionEmoji = '❓';
                            break;
                        }

                        const products = loadData(productsFilePath, []);
                        let foundProduct = null;
                        let foundVariation = null;

                        for (const p of products) {
                            if (p.variations && Array.isArray(p.variations)) {
                                const v = p.variations.find(v => `${p.id}-${v.code}`.toLowerCase() === variationCode.toLowerCase());
                                if (v) {
                                    foundProduct = p;
                                    foundVariation = v;
                                    break; 
                                }
                            }
                        }
                        
                        if (!foundProduct) {
                            await sendFormattedMessage(from, `Maaf, kode varian \`${variationCode}\` tidak ditemukan.`);
                            reactionEmoji = '❌';
                            break; 
                        }

                        const stock = loadData(stockFilePath, {});
                        const fullVariationCode = `${foundProduct.id}-${foundVariation.code}`;
                        const availableStock = stock[fullVariationCode.toUpperCase()] ? stock[fullVariationCode.toUpperCase()].length : 0;
                        
                        if (availableStock < quantity) {
                            await sendFormattedMessage(from, `Maaf, stok untuk *${foundVariation.name}* tidak mencukupi. Sisa stok: ${availableStock}.`);
                            reactionEmoji = '😥';
                            break;
                        }
                        
                        const totalPrice = foundVariation.price * quantity;
                        let confirmationMessage = `*🛒 KONFIRMASI PESANAN*\n\n`;
                        confirmationMessage += `*Kamu akan membeli:*\n`;
                        confirmationMessage += `> *Produk:* ${foundProduct.name} - ${foundVariation.name}\n`;
                        confirmationMessage += `> *Jumlah:* ${quantity}\n`;
                        confirmationMessage += `> *Total Harga:* Rp ${totalPrice.toLocaleString('id-ID')}\n\n`;
                        confirmationMessage += `*Panduan Pembayaran:*\n> Pembayaran akan menggunakan QRIS yang akan kedaluwarsa dalam 5 menit. Pastikan Kamu siap untuk melakukan scan.\n\nBalas dengan *YA* untuk melanjutkan, atau *BATAL* untuk membatalkan.`;
                        
                        const timeoutId = setTimeout(() => {
                            if (userState[senderId] && userState[senderId].state === 'awaiting_purchase_confirmation') {
                                delete userState[senderId];
                                sock.sendMessage(from, { text: "⏳ Waktu konfirmasi pembayaran habis, pesanan otomatis dibatalkan." });
                            }
                        }, 300000);
                        
                        userState[senderId] = { state: 'awaiting_purchase_confirmation', variationCode: fullVariationCode.toUpperCase(), quantity: quantity, timeoutId: timeoutId };
                        await sendFormattedMessage(from, confirmationMessage);
                        reactionEmoji = '🤔';
                        break;
                    }
                    case '/panduan':
                    case '/carabeli': {
                        await sendFormattedMessage(from, PANDUAN_TEXT);
                        reactionEmoji = '📖';
                        break;
                    }
                    case '/riwayat': {
                        const transactions = loadData(transactionsFilePath, {});
                        const usersData = loadData(usersFilePath, {});
                        const userTransactions = usersData[senderId]?.transactions || [];
                        let historyMessage = `*📜 RIWAYAT TRANSAKSI KAMU*\n\n`;
                        if (userTransactions.length === 0) {
                            historyMessage += "Kamu belum memiliki riwayat transaksi yang berhasil.";
                        } else {
                            historyMessage += `Berikut adalah transaksi terakhir Kamu:\n`;
                            userTransactions.forEach(orderId => {
                                const t = transactions[orderId];
                                if (t) {
                                    historyMessage += `\n--------------------\n`;
                                    historyMessage += `> *Produk:* ${t.productName}\n`;
                                    historyMessage += `> *Jumlah:* ${t.quantity}\n`;
                                    historyMessage += `> *Tanggal:* ${new Date(t.createdAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}\n`;
                                }
                            });
                        }
                        await sendFormattedMessage(from, historyMessage);
                        reactionEmoji = '📜';
                        break;
                    }
                    case '/produkpopuler': {
                        const transactions = loadData(transactionsFilePath, {});
                        const products = loadData(productsFilePath, []);
                        const salesCount = {};
                        Object.values(transactions).forEach(t => {
                            if (t.status === 'COMPLETED') {
                                const mainProductId = t.productId;
                                if (!salesCount[mainProductId]) salesCount[mainProductId] = 0;
                                salesCount[mainProductId] += t.quantity;
                            }
                        });
                        const sortedProducts = Object.entries(salesCount).sort(([, a], [, b]) => b - a).slice(0, 5);
                        let popularMessage = `*🔥 PRODUK TERLARIS - NUSA KARSA*\n\nBerikut adalah 5 produk paling populer di toko kami:\n`;
                        if (sortedProducts.length === 0) {
                            popularMessage += "\nBelum ada produk yang terjual.";
                        } else {
                            sortedProducts.forEach(([productId, sold], index) => {
                                const productInfo = products.find(p => p.id === productId);
                                if (productInfo) {
                                    popularMessage += `\n*${index + 1}. ${productInfo.name}*`;
                                    popularMessage += `\n   - _Terjual ${sold} pcs_`;
                                }
                            });
                        }
                        await sendFormattedMessage(from, popularMessage);
                        reactionEmoji = '🔥';
                        break;
                    }
                    case '/info': {
                        const users = loadData(usersFilePath, {});
                        const transactions = loadData(transactionsFilePath, {});
                        const userId = senderId.split('@')[0];
                        const userTransactions = users[senderId]?.transactions || [];
                        let userTotalSpent = 0;
                        userTransactions.forEach(orderId => {
                            const t = transactions[orderId];
                            if (t && t.status === 'COMPLETED') {
                                const products = loadData(productsFilePath, []);
                                const product = products.find(p => p.id === t.productId);
                                if (product && product.variations) {
                                    // ... di dalam case '/info', bagian userTransactions.forEach ...
// PERBAIKAN: Cocokkan dengan KODE LENGKAP
const variation = product.variations.find(v => `${product.id}-${v.code}`.toUpperCase() === t.variationCode.toUpperCase());
if(variation) userTotalSpent += variation.price * t.quantity;
                                }
                            }
                        });
                        let totalSold = 0;
                        let totalRevenue = 0;
                        Object.values(transactions).forEach(t => {
                            if(t.status === 'COMPLETED') {
                                totalSold += t.quantity;
                                const products = loadData(productsFilePath, []);
                                const product = products.find(p => p.id === t.productId);
                                if (product && product.variations) {
                                    // ... di dalam case '/info', bagian Object.values(transactions).forEach ...
// PERBAIKAN: Cocokkan dengan KODE LENGKAP
const variation = product.variations.find(v => `${product.id}-${v.code}`.toUpperCase() === t.variationCode.toUpperCase());
if(variation) totalRevenue += variation.price * t.quantity;
                                }
                            }
                        });
                        const totalUsers = Object.keys(users).length;
                        const uptime = formatUptime(botStartTime);
                        
                        let infoMessage = `Halo ${userName} 👋\n\n`;
                        infoMessage += `*User Info :*\n`;
                        infoMessage += `└ ID : ${userId}\n`;
                        infoMessage += `└ Username : ${userName}\n`;
                        infoMessage += `└ Total Belanja : Rp. ${userTotalSpent.toLocaleString('id-ID')}\n\n`;
                        infoMessage += `*BOT Stats :*\n`;
                        infoMessage += `└ Produk Terjual : ${totalSold.toLocaleString('id-ID')} pcs\n`;
                        infoMessage += `└ Total Pendapatan : Rp. ${totalRevenue.toLocaleString('id-ID')}\n`;
                        infoMessage += `└ Total User : ${totalUsers}\n`;
                        infoMessage += `└ Uptime : ${uptime}\n`;
                        infoMessage += `└ Ver : ${BOT_VERSION}\n\n`;
                        infoMessage += `*Shortcuts menu :*\n`;
                        infoMessage += `> \`/katalog\` – Cek stok produk\n`;
                        infoMessage += `> \`/riwayat\` – Cek riwayat pembelian\n`;
                        infoMessage += `> \`/panduan\` – Cara membeli`;
                        await sendFormattedMessage(from, infoMessage);
                        reactionEmoji = '📊';
                        break;
                    }
                    case '/owner': {
                        await sendFormattedMessage(from, OWNER_TEXT);
                        reactionEmoji = '👨‍💻';
                        break;
                    }
                    case '/cs':
                    case '/bantuan': {
                        const question = args.join(' ');
                        if (!question) {
                            const csGuide = `*🤖 CUSTOMER SERVICE AI - NUSA KARSA*\n\nAda yang bisa saya bantu? Silakan ajukan pertanyaan Kamu setelah perintah.\n\n> *Contoh:*\n> \`/cs bagaimana cara melihat riwayat pembelian saya?\`\n> \`/cs apakah produk Netflix ready?\`\n\nSaya akan berusaha menjawab pertanyaan seputar produk dan cara penggunaan bot.`;
                            await sendFormattedMessage(from, csGuide);
                            reactionEmoji = '💬';
                            break;
                        }
                        await sock.sendPresenceUpdate('composing', from);
                        const answer = await askCS(question);
                        await sendFormattedMessage(from, `*🤖 Jawaban dari CS Karsa:*\n\n${answer}`);
                        reactionEmoji = '✅';
                        break;
                    }
                    case '/tambahproduk': {
                        if (senderId !== ownerJid) return;
                        const argsText = args.join(' ');
                        const parts = argsText.split('|').map(s => s.trim());
                        if (parts.length < 4) {
                            await sendFormattedMessage(from, "Format salah.\n`/tambahproduk ID|Nama|Deskripsi|KODE:NamaVarian:Harga`\n\n*Catatan:*\n- Untuk menambah varian, gunakan ID produk yang sudah ada.");
                            reactionEmoji = '❓';
                            break;
                        }
                        const [id, name, description, ...variationsText] = parts;
                        const products = loadData(productsFilePath, []);
                        const productIndex = products.findIndex(p => p.id.toLowerCase() === id.toLowerCase());
                        try {
                            const newVariations = variationsText.map(v => {
                                const [code, varName, price] = v.split(':');
                                if (!code || !varName || !price || isNaN(parseInt(price))) throw new Error('Format variasi salah');
                                return { code: code.toUpperCase(), name: varName, price: parseInt(price) };
                            });
                            if (productIndex > -1) {
                                products[productIndex].variations.push(...newVariations);
                                saveData(productsFilePath, products);
                                await sendFormattedMessage(from, `✅ Berhasil! ${newVariations.length} variasi baru ditambahkan ke produk *${products[productIndex].name}*.`);
                                reactionEmoji = '➕';
                            } else {
                                const newProduct = { id: id.toUpperCase(), name, description, totalSold: 0, variations: newVariations };
                                products.push(newProduct);
                                saveData(productsFilePath, products);
                                await sendFormattedMessage(from, `✅ Produk baru *${name}* dengan ${newVariations.length} variasi berhasil dibuat.`);
                                reactionEmoji = '✨';
                            }
                        } catch(e) {
                            await sendFormattedMessage(from, "Gagal memproses. Pastikan format variasi `KODE:NAMA:HARGA` sudah benar.");
                            reactionEmoji = '❌';
                        }
                        break;
                    }
                    case '/editproduk': {
                        if (senderId !== ownerJid) return;
                        const [productId, property, ...valueParts] = args;
                        const value = valueParts.join(' ');
                        if (!productId || !property || !value) {
                             await sendFormattedMessage(from, "Format salah. Gunakan:\n`/editproduk <ID_PRODUK> <properti> <nilai_baru>`\n\n*Properti yang bisa diubah:*\n- `nama`\n- `desk` (untuk deskripsi)");
                             reactionEmoji = '❓';
                             break;
                        }
                        const products = loadData(productsFilePath, []);
                        const productIndex = products.findIndex(p => p.id.toLowerCase() === productId.toLowerCase());
                        if (productIndex === -1) {
                            await sendFormattedMessage(from, `Produk dengan ID \`${productId}\` tidak ditemukan.`);
                            reactionEmoji = '❌';
                            break;
                        }
                        if (property.toLowerCase() === 'nama') {
                            products[productIndex].name = value;
                            await sendFormattedMessage(from, `✅ Nama produk \`${productId}\` berhasil diubah menjadi *${value}*.`);
                        } else if (property.toLowerCase() === 'desk') {
                            products[productIndex].description = value;
                            await sendFormattedMessage(from, `✅ Deskripsi produk \`${productId}\` berhasil diubah.`);
                        } else {
                            await sendFormattedMessage(from, `Properti \`${property}\` tidak valid. Gunakan 'nama' atau 'desk'.`);
                            reactionEmoji = '❓';
                            return;
                        }
                        saveData(productsFilePath, products);
                        reactionEmoji = '✏️';
                        break;
                    }
                    case '/settotalsold': {
                        if (senderId !== ownerJid) return;
                        const [productId, count] = args;
                        if (!productId || isNaN(parseInt(count))) {
                            await sendFormattedMessage(from, "Format salah. Gunakan: `/settotalsold <ID_PRODUK> <jumlah>`\nContoh: `/settotalsold CANVA 1500`");
                            reactionEmoji = '❓';
                            break;
                        }
                        const products = loadData(productsFilePath, []);
                        const productIndex = products.findIndex(p => p.id.toLowerCase() === productId.toLowerCase());
                        if (productIndex === -1) {
                            await sendFormattedMessage(from, `Produk dengan ID \`${productId}\` tidak ditemukan.`);
                            reactionEmoji = '❌';
                            break;
                        }
                        products[productIndex].totalSold = parseInt(count);
                        saveData(productsFilePath, products);
                        await sendFormattedMessage(from, `✅ Jumlah terjual untuk produk \`${productId}\` berhasil diatur ke *${count}*.`);
                        reactionEmoji = '🔢';
                        break;
                    }
                    case '/hapusproduk': {
                        if (senderId !== ownerJid) return;
                        const [productId]_ = args;
                        if (!productId) {
                            await sendFormattedMessage(from, "Format salah. Gunakan: `/hapusproduk <ID_PRODUK>`");
                            reactionEmoji = '❓';
                            break;
                        }
                        let products = loadData(productsFilePath, []);
                        const initialLength = products.length;
                        products = products.filter(p => p.id.toLowerCase() !== productId.toLowerCase());
                        if (products.length === initialLength) {
                             await sendFormattedMessage(from, `Produk dengan ID \`${productId}\` tidak ditemukan.`);
                             reactionEmoji = '❌';
                        } else {
                            saveData(productsFilePath, products);
                            await sendFormattedMessage(from, `✅ Produk \`${productId}\` berhasil dihapus dari katalog.`);
                            reactionEmoji = '🗑️';
                        }
                        break;
                    }
                    case '/hapusvarian': {
                        if (senderId !== ownerJid) return;
                        const [variationCode] = args;
                        if (!variationCode) {
                            await sendFormattedMessage(from, "Format salah. Gunakan: `/hapusvarian <KODE_VARIAN>`\nContoh: `/hapusvarian CANVA-EDU`");
                            reactionEmoji = '❓';
                            break;
                        }
                        const products = loadData(productsFilePath, []);
                        const parts = variationCode.split('-');
                        const varCode = parts.pop();
                        const productId = parts.join('-');
                        if (!productId || !varCode) {
                            await sendFormattedMessage(from, "Format kode varian salah.");
                            reactionEmoji = '❓';
                            break;
                        }
                        const productIndex = products.findIndex(p => p.id.toLowerCase() === productId.toLowerCase());
                        if (productIndex === -1) {
                             await sendFormattedMessage(from, `Produk dengan ID \`${productId}\` tidak ditemukan.`);
                             reactionEmoji = '❌';
                             break;
                        }
                        const initialVarLength = products[productIndex].variations.length;
                        products[productIndex].variations = products[productIndex].variations.filter(v => v.code.toLowerCase() !== varCode.toLowerCase());
                        if (products[productIndex].variations.length === initialVarLength) {
                            await sendFormattedMessage(from, `Varian dengan kode \`${variationCode}\` tidak ditemukan.`);
                            reactionEmoji = '❌';
                        } else {
                            saveData(productsFilePath, products);
                            await sendFormattedMessage(from, `✅ Varian \`${variationCode}\` berhasil dihapus.`);
                            reactionEmoji = '🗑️';
                        }
                        break;
                    }
                    case '/tambahstok': {
                        if (senderId !== ownerJid) return;
                        const [variationCode, ...newStockItems] = args;
                        if (!variationCode || newStockItems.length === 0) {
                            await sendFormattedMessage(from, "Format salah. Gunakan:\n`/tambahstok <KODE_VARIAN> <item1> <item2> ...`\nContoh: `/tambahstok CANVA-EDU email:pass`" );
                            reactionEmoji = '❓';
                            break;
                        }
                        const stock = loadData(stockFilePath, {});
                        const upperVariationCode = variationCode.toUpperCase();
                        if (!stock[upperVariationCode]) stock[upperVariationCode] = [];
                        stock[upperVariationCode].push(...newStockItems);
                        saveData(stockFilePath, stock);
                        await sendFormattedMessage(from, `✅ Berhasil! ${newStockItems.length} item baru ditambahkan ke stok \`${upperVariationCode}\`.` );
                        reactionEmoji = '📦';
                        break;
                    }
                    case '/cekstok': {
                        if (senderId !== ownerJid) return;
                        const products = loadData(productsFilePath, []);
                        const stock = loadData(stockFilePath, {});
                        let stockMessage = "*📦 LAPORAN STOK SAAT INI*\n\n";
                        products.forEach(p => {
                            stockMessage += `*${p.name}* (\`${p.id}\`)\n`;
                            if (p.variations && p.variations.length > 0) {
                                p.variations.forEach(v => {
                                    const variationCode = `${p.id}-${v.code}`;
                                    const stockCount = stock[variationCode.toUpperCase()] ? stock[variationCode.toUpperCase()].length : 0;
                                    stockMessage += `> \`${v.name}\`: ${stockCount} item\n`;
                                });
                            } else { stockMessage += `> (Tidak ada variasi)\n`; }
                        });
                        await sendFormattedMessage(from, stockMessage);
                        reactionEmoji = '📊';
                        break;
                    }
                    case '/statistik': {
                        if (senderId !== ownerJid) return;
                        const transactions = loadData(transactionsFilePath, {});
                        const products = loadData(productsFilePath, []);
                        const stats = {};
                        let totalRevenue = 0;
                        Object.values(transactions).forEach(t => {
                            if (t.status === 'COMPLETED') {
                                if (!stats[t.productId]) {
                                    const productInfo = products.find(p => p.id === t.productId);
                                    stats[t.productId] = { name: productInfo ? productInfo.name : t.productId, sold: 0, revenue: 0 };
                                }
                                // ... di dalam case '/statistik' ...
let price = 0;
const productInfo = products.find(p => p.id === t.productId);
if(productInfo && productInfo.variations){
    // PERBAIKAN: Cocokkan dengan KODE LENGKAP (`CANVA-EDU`), bukan hanya `EDU`
    const variationInfo = productInfo.variations.find(v => `${productInfo.id}-${v.code}`.toUpperCase() === t.variationCode.toUpperCase());
    if(variationInfo) price = variationInfo.price;
}
                                stats[t.productId].sold += t.quantity;
                                stats[t.productId].revenue += t.quantity * price;
                                totalRevenue += t.quantity * price;
                            }
                        });
                        const sortedStats = Object.values(stats).sort((a, b) => b.sold - a.sold);
                        let statsMessage = `*📈 STATISTIK PENJUALAN - NUSA KARSA*\n\n`;
                        if (sortedStats.length === 0) {
                            statsMessage += "Belum ada produk yang terjual.";
                        } else {
                            statsMessage += `*Produk Terlaris (Berdasarkan Kategori Utama):*\n`;
                            sortedStats.forEach((stat, index) => {
                                statsMessage += `${index + 1}. *${stat.name}*\n   - Terjual: ${stat.sold} unit\n   - Pendapatan: Rp ${stat.revenue.toLocaleString('id-ID')}\n`;
                            });
                            statsMessage += `\n--------------------\n*Total Pendapatan Keseluruhan:* Rp ${totalRevenue.toLocaleString('id-ID')}`;
                        }
                        await sendFormattedMessage(from, statsMessage);
                        reactionEmoji = '📈';
                        break;
                    }
                    case '/unblock': {
                        if (senderId !== ownerJid) return;
                        const numberToUnblock = args[0];
                        if (!numberToUnblock) {
                            await sendFormattedMessage(from, `Gunakan format: \`/unblock <nomor_wa>\`\nContoh: \`/unblock 6281234567890\`` );
                            reactionEmoji = '❓';
                            break;
                        }
                        const targetJid = `${numberToUnblock.replace(/\D/g, '')}@s.whatsapp.net`;
                        let blocked = loadData(blockedFilePath, []);
                        if (!blocked.includes(targetJid)) {
                            await sendFormattedMessage(from, `Nomor tersebut tidak ada dalam daftar blokir bot.` );
                            reactionEmoji = '🤔';
                            break;
                        }
                        await sock.updateBlockStatus(targetJid, "unblock");
                        blocked = blocked.filter(jid => jid !== targetJid);
                        saveData(blockedFilePath, blocked);
                        await sock.sendMessage(from, { text: `✅ Berhasil! Blokir untuk @${targetJid.split('@')[0]} telah dibuka.`, mentions: [targetJid] });
                        await sock.sendMessage(targetJid, { text: `Alhamdulillah, blokir Kamu telah dibuka oleh Owner. Kamu sekarang bisa menggunakan bot ini lagi.` });
                        reactionEmoji = '🔓';
                        break;
                    }
                    case '/broadcast': {
                        if (senderId !== ownerJid) return;
                        const replied = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                        const isMediaMsg = msg.message.imageMessage || msg.message.videoMessage;
                        let broadcastMessageContent = args.join(' ');
                        let mediaBuffer = null;
                        let mediaType = null;
                        if (replied && replied.conversation) {
                            broadcastMessageContent = replied.conversation;
                        }
                        if (isMediaMsg) {
                            mediaType = msg.message.imageMessage ? 'image' : 'video';
                            mediaBuffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }) });
                            if (body.trim().length > command.length) {
                                broadcastMessageContent = body.substring(command.length).trim();
                            }
                        }
                        if (!broadcastMessageContent && !mediaBuffer) {
                            await sendFormattedMessage(from, `Gunakan format:\n1. \`/broadcast <pesan>\`\n2. Reply pesan teks, lalu ketik \`/broadcast\`\n3. Kirim gambar/video dengan caption \`/broadcast <pesan>\``);
                            reactionEmoji = '❓';
                            break;
                        }
                        const allUsers = Object.keys(loadData(usersFilePath, {}));
                        await sendFormattedMessage(from, `📢 Memulai broadcast ke *${allUsers.length}* pengguna...`);
                        let successCount = 0;
                        let failCount = 0;
                        for (const jid of allUsers) {
                            try {
                                const finalMessageHeader = `*📢 BROADCAST - NUSA KARSA*\n\n`;
                                const finalMessageText = finalMessageHeader + broadcastMessageContent;
                                if (mediaBuffer) {
                                    await sock.sendMessage(jid, { [mediaType]: mediaBuffer, caption: finalMessageText });
                                } else {
                                    await sock.sendMessage(jid, { text: finalMessageText });
                                }
                                successCount++;
                                await new Promise(resolve => setTimeout(resolve, 1000));
                            } catch (e) {
                                console.error(`[BROADCAST ERROR] Gagal mengirim ke ${jid}:`, e.message);
                                failCount++;
                            }
                        }
                        await sendFormattedMessage(from, `✅ *BROADCAST SELESAI!*\n\n- Terkirim: ${successCount}\n- Gagal: ${failCount}`);
                        reactionEmoji = '📢';
                        break;
                    }
                    case '/debugowner': {
                        if (senderId !== ownerJid) return;
                        const debugText = `*⚙️ Info Debug Owner*\n\nBerikut adalah data yang digunakan untuk perbandingan:\n\n*1. senderId (Nomor Kamu menurut WA):*\n\`\`\`${senderId}\`\`\`\n\n*2. ownerJid (Nomor dari .env):*\n\`\`\`${ownerJid}\`\`\`\n\n*3. Hasil Perbandingan Langsung:*\n\`\`\`${senderId === ownerJid}\`\`\`\n\n*Pastikan kedua nomor di atas sama persis, termasuk bagian belakang '@s.whatsapp.net' dan tidak ada spasi tersembunyi di file .env Kamu.*`;
                        await sock.sendMessage(from, { text: debugText });
                        reactionEmoji = '🐛';
                        break;
                    }
                    default:
                        await sendFormattedMessage(from, `Maaf, perintah \`${command}\` tidak dikenali. Ketik \`/menu\` untuk melihat daftar perintah.` );
                        reactionEmoji = '❓';
                        break;
                }
            } else {
                if (!from.endsWith('@g.us')) {
                    if (!greetedUsers.has(senderId)) {
                        const { greeting, emoji } = getDynamicGreeting();
                        const menuText = generateMenuText(senderId === `${OWNER_NUMBER}@s.whatsapp.net`);
                        const mainText = `Halo ${userName}, ${greeting} ${emoji}\n\nSelamat datang di NUSA KARSA!\n\n${menuText}`;
                        await sendFormattedMessage(from, mainText);
                        greetedUsers.add(senderId);
                        reactionEmoji = '👋';
                    }
                }
            }
        } catch (error) {
            console.error("[ERROR UTAMA]", error);
            if (userState[senderId]) delete userState[senderId];
            reactionEmoji = '⚠️';
        } finally {
            if (reactionEmoji) {
                try {
                    await sock.sendMessage(from, { react: { text: reactionEmoji, key: msg.key } });
                } catch (e) { /* Abaikan error reaksi */ }
            }
        }
    });
} // <--- KURUNG KURAWAL PENUTUP UNTUK FUNGSI connectToWhatsApp()    


// ======================================================
// SERVER WEB (EXPRESS) UNTUK WEBHOOK, QR, & DASHBOARD
// ======================================================
const app = express();
const cookieParser = require('cookie-parser');
const session = require('express-session');

// --- Setup Middleware untuk Express ---
app.set('view engine', 'ejs'); // Set EJS sebagai view engine
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Untuk membaca data dari form
app.use(cookieParser());
app.use(session({
    secret: 'rahasia-tersembunyi-nusa-karsa', // Ganti dengan secret key acak kamu sendiri
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // Cookie berlaku selama 1 hari
}));

// --- Middleware untuk Cek Login ---
const checkAuth = (req, res, next) => {
    if (req.session.isLoggedIn) {
        next();
    } else {
        res.redirect('/login');
    }
};

// --- Rute Halaman Login ---
app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

app.post('/login', (req, res) => {
    const adminPassword = process.env.ADMIN_PASSWORD || "admin123"; // Ganti password default di file .env kamu
    if (req.body.password === adminPassword) {
        req.session.isLoggedIn = true;
        res.redirect('/admin');
    } else {
        res.render('login', { error: 'Password salah!' });
    }
});

// --- Rute Logout ---
app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.redirect('/admin');
        }
        res.clearCookie('connect.sid');
        res.redirect('/login');
    });
});

// --- Rute Halaman Dashboard Utama ---
app.get('/admin', checkAuth, (req, res) => {
    const products = loadData(productsFilePath, []);
    const stock = loadData(stockFilePath, {});
    res.render('dashboard', { products, stock });
});

// --- Rute untuk memproses penambahan stok ---
app.post('/admin/add-stock', checkAuth, (req, res) => {
    const { variationCode, stockItems } = req.body;
    if (!variationCode || !stockItems) {
        return res.status(400).send('Data tidak lengkap.');
    }

    try {
        const stock = loadData(stockFilePath, {});
        const upperVariationCode = variationCode.toUpperCase();
        
        // Memecah item stok berdasarkan baris baru dan memfilter baris kosong
        const newStockItems = stockItems.split(/\r?\n/).filter(line => line.trim() !== '');

        if (!stock[upperVariationCode]) {
            stock[upperVariationCode] = [];
        }
        stock[upperVariationCode].push(...newStockItems);
        saveData(stockFilePath, stock);
        
        console.log(`[DASHBOARD] Stok untuk ${upperVariationCode} berhasil ditambahkan sebanyak ${newStockItems.length} item.`);
        res.redirect('/admin');
    } catch (error) {
        console.error('[DASHBOARD ERROR] Gagal menambah stok:', error);
        res.status(500).send('Gagal menyimpan stok.');
    }
});


// Endpoint untuk cek status server
app.get('/', (req, res) => {
    res.send('NUSA KARSA Bot Server is running!');
});

// Endpoint untuk menampilkan QR code dari file
app.get('/qr', (req, res) => {
    if (fs.existsSync(__dirname + '/qr.png')) {
        res.sendFile(__dirname + '/qr.png');
    } else {
        res.status(404).send("QR code tidak tersedia. Silakan tunggu atau hubungkan ulang bot untuk memunculkan QR baru.");
    }
});

// Endpoint untuk menerima notifikasi Webhook dari Midtrans
app.post('/webhook', async (req, res) => {
    try {
        const notification = req.body;
        console.log('[WEBHOOK] Notifikasi diterima:', JSON.stringify(notification, null, 2));
        
        const orderId = notification.order_id;
        const transactionStatus = notification.transaction_status;
        
        if (transactionStatus === 'settlement' || transactionStatus === 'capture') {
            const transactions = loadData(transactionsFilePath);
            const orderData = transactions[orderId];
            
            if (orderData && orderData.status === 'PENDING') {
                const stock = loadData(stockFilePath);
                let deliveredItems = [];
                
                for (let i = 0; i < orderData.quantity; i++) {
                    const item = stock[orderData.variationCode.toUpperCase()]?.shift();
                    if (item) deliveredItems.push(item);
                }

                if (deliveredItems.length > 0) {
                    const transactionDate = new Date(orderData.createdAt).toLocaleString('id-ID', {
                        timeZone: 'Asia/Jakarta',
                        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                        hour: '2-digit', minute: '2-digit'
                    });

                    const productMessage = `
*✅ PEMBAYARAN BERHASIL*

Terima kasih telah berbelanja di NUSA KARSA. Pesananmu telah berhasil diproses ✨

Berikut adalah detail produk yang Kamu beli, harap segera amankan data yang telah diberikan:

🧾 *INVOICE PEMBELIAN*
> *Nomor Pesanan:* \`${orderId}\`
> *Tanggal Transaksi:* ${transactionDate} WIB
> *Detail Produk:* ${orderData.productName}
> *Jumlah:* ${orderData.quantity}
> *Data:* \`\`\`${deliveredItems.join('\n')}\`\`\`
`;
                    await sendFormattedMessage(orderData.userId, productMessage);

                    if (orderData.messageKey) {
                        try {
                            await sock.sendMessage(orderData.userId, { delete: orderData.messageKey });
                            console.log(`[CLEANUP] Pesan tagihan untuk order ${orderId} berhasil dihapus.`);
                        } catch (e) {
                            console.error(`[CLEANUP] Gagal menghapus pesan tagihan untuk order ${orderId}:`, e);
                        }
                    }

                    const users = loadData(usersFilePath);
                    if (users[orderData.userId]) {
                        if (!users[orderData.userId].transactions) users[orderData.userId].transactions = [];
                        users[orderData.userId].transactions.push(orderId);
                        saveData(usersFilePath, users);
                    }

                    const products = loadData(productsFilePath, []);
                    const productIndex = products.findIndex(p => p.id === orderData.productId);
                    if(productIndex !== -1){
                        if(!products[productIndex].totalSold) products[productIndex].totalSold = 0;
                        products[productIndex].totalSold += orderData.quantity;
                        saveData(productsFilePath, products);
                    }

                    orderData.status = "COMPLETED";
                    saveData(transactionsFilePath, transactions);
                    saveData(stockFilePath, stock);
                    console.log(`[PRODUK TERKIRIM] ${orderData.quantity} item ${orderData.variationCode} ke ${orderData.userId}`);
                } else {
                    console.error(`[STOK HABIS] Gagal kirim produk untuk Order ID ${orderId}`);
                    await sendFormattedMessage(orderData.userId, `Mohon maaf, terjadi masalah: stok produk habis tepat saat pembayaranmu diproses. Silakan hubungi Owner dengan menyertakan ID Pesanan ini untuk penanganan lebih lanjut: \`${orderId}\``);
                    await sendFormattedMessage(`${OWNER_NUMBER}@s.whatsapp.net`, `⚠️ PERHATIAN: Stok habis untuk pesanan ${orderId}`);
                }
            }
        }
        res.status(200).send('OK');
    } catch (error) {
        console.error("[WEBHOOK ERROR]", error);
        res.status(500).send('Internal Server Error');
    }
});

// --- JALANKAN SEMUANYA ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    ensureDbFolderExists(); // Pastikan folder database ada sebelum bot jalan
    console.log(`[SERVER] Server berjalan di port ${PORT}`);
    connectToWhatsApp(); // Jalankan bot setelah server web siap
});
