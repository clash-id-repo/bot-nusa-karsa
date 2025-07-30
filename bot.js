// ======================================================
// INISIALISASI & IMPORT LIBRARY
// ======================================================
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal'); 
const fs = require('fs');
const axios = require('axios');
const express = require('express');
require('dotenv').config();

// ======================================================
// KONFIGURASI & VARIABEL GLOBAL
// ======================================================
const OWNER_NUMBER = process.env.OWNER_NUMBER || 'gantinomormu';
const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY || 'ganti_kunci_server_midtrans';

let botJid = '';
let sock = null; 
let userState = {};
let greetedUsers = new Set();
let userActivity = {};

// Konfigurasi Anti-Spam & Anti-Telepon
const SPAM_MESSAGE_LIMIT = 7; // Jumlah pesan
const SPAM_TIME_LIMIT = 4000; // Dalam 4 detik
const CALL_COOLDOWN_SECONDS = 10; // Jeda antar deteksi telepon
let callHistory = new Map();

// Path file data
const dataDir = './data';
const productsFilePath = `${dataDir}/products.json`;
const stockFilePath = `${dataDir}/stock.json`;
const transactionsFilePath = `${dataDir}/transactions.json`;
const usersFilePath = `${dataDir}/users.json`;
const blockedFilePath = `${dataDir}/blocked.json`;

// ======================================================
// FUNGSI PEMUATAN & PENYIMPANAN DATA
// ======================================================
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}

function loadData(filePath, defaultValue) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath));
        }
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
// FUNGSI HELPER TAMBAHAN
// ======================================================
/**
 * Memberikan batas waktu pada sebuah Promise.
 * @param {Promise} promise Promise yang ingin diberi batas waktu.
 * @param {number} ms Durasi timeout dalam milidetik.
 * @returns {Promise}
 */
function promiseWithTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error(`Proses melebihi batas waktu ${ms} ms`));
        }, ms);

        promise.then(
            (res) => {
                clearTimeout(timeoutId);
                resolve(res);
            },
            (err) => {
                clearTimeout(timeoutId);
                reject(err);
            }
        );
    });
}

// ======================================================
// FUNGSI UTAMA BOT
// ======================================================
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: ['Nusa Karsa', 'Chrome', '1.0.0'],
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('------------------------------------------------');
            console.log('    Silakan Scan QR Code di Bawah Ini    ');
            console.log('------------------------------------------------');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus karena:', lastDisconnect.error, ', menyambungkan kembali:', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            botJid = sock.user.id;
            greetedUsers.clear();
            console.log('✨ Bot Nusa Karsa berhasil tersambung!');
        }
    });

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
        
        try {
            const senderId = from.endsWith('@g.us') ? msg.key.participant : from;
            const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
            const userName = msg.pushName || "Pelanggan";

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
                        await sock.sendMessage(from, { text: "‼️ *PERINGATAN SPAM* ‼️\n\nAnda terdeteksi melakukan spam. Nomor Anda akan diblokir secara otomatis. Hubungi Owner jika ini adalah kesalahan." });
                        await sock.updateBlockStatus(senderId, "block");
                        blocked.push(senderId);
                        saveData(blockedFilePath, blocked);
                        await sock.sendMessage(ownerJid, { text: `🚫 *Pengguna Diblokir (Spam)* 🚫\n\nPengguna @${senderId.split('@')[0]} telah diblokir karena melakukan spam.`, mentions: [senderId] });
                    }
                    return;
                }
            }
            
            if(!body) return;
            
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

            // PRIORITAS 1: TANGANI STATE HANYA JIKA PESAN BUKAN PERINTAH BARU
            if (userState[senderId] && !isCmd) {
                const currentStateData = userState[senderId];
                const lowerBody = body.toLowerCase();

                if (currentStateData.state === 'awaiting_catalog_choice') {
                    if (lowerBody === 'selesai' || lowerBody === 'keluar' || lowerBody === 'batal') {
                        delete userState[senderId];
                        await sock.sendMessage(from, { text: "Oke, Anda telah keluar dari mode katalog." });
                        reactionEmoji = '👍';
                        return;
                    }
                    const choice = parseInt(body);
                    const products = loadData(productsFilePath, []);
                    if (!isNaN(choice) && choice > 0 && choice <= products.length) {
                        const product = products[choice - 1];
                        const stock = loadData(stockFilePath, {});
                        const stockCount = stock[product.id] ? stock[product.id].length : 0;
                        let detailMessage = `*📄 Detail Produk*\n\n`;
                        detailMessage += `> *Nama:* ${product.name}\n`;
                        detailMessage += `> *Harga:* Rp ${product.price.toLocaleString('id-ID')}\n`;
                        detailMessage += `> *Stok Tersedia:* ${stockCount > 0 ? stockCount : 'Habis'}\n\n`;
                        detailMessage += `_${product.description || 'Tidak ada deskripsi.'}_\n\n`;
                        detailMessage += `--------------------\n`;
                        detailMessage += `Untuk membeli produk ini, ketik:\n\`\`\`/beli ${product.id} 1\`\`\`\n\n`;
                        detailMessage += `Ketik *nomor lain* untuk melihat detail produk lain, atau ketik *selesai* untuk keluar.`;
                        await sock.sendMessage(from, { text: detailMessage });
                        reactionEmoji = '📄';
                    } else {
                        await sock.sendMessage(from, { text: "Pilihan tidak valid. Silakan masukkan nomor produk yang benar, atau ketik *selesai* untuk keluar." });
                        reactionEmoji = '❓';
                    }
                    return;
                }

                if (currentStateData.state === 'awaiting_purchase_confirmation') {
                    clearTimeout(currentStateData.timeoutId);
                    if (lowerBody === 'ya') {
                        const { productId, quantity } = currentStateData;
                        const products = loadData(productsFilePath, []);
                        const product = products.find(p => p.id === productId);
                        const totalPrice = product.price * quantity;
                        const orderId = `NK-${senderId.split('@')[0]}-${Date.now()}`;
                        
                        const transactionDetails = {
                            transaction_details: { order_id: orderId, gross_amount: totalPrice },
                            payment_type: "qris",
                            custom_expiry: { expiry_duration: 5, unit: "minute" },
                            customer_details: { first_name: userName, phone: senderId.split('@')[0] }
                        };

                        await sock.sendMessage(from, { text: "⏳ Oke, sedang membuat tagihan QRIS, mohon tunggu..." });

                        let midtransResponse = null;
                        let attempts = 0;
                        const maxAttempts = 3;
                        while (attempts < maxAttempts && !midtransResponse) {
                            try {
                                attempts++;
                                const axiosPromise = axios.post('https://api.sandbox.midtrans.com/v2/charge', transactionDetails, {
                                    headers: {
                                        'Authorization': 'Basic ' + Buffer.from(MIDTRANS_SERVER_KEY).toString('base64'), 'Content-Type': 'application/json', 'Accept': 'application/json'
                                    }
                                });
                                const response = await promiseWithTimeout(axiosPromise, 15000);
                                midtransResponse = response;
                            } catch (error) {
                                console.error(`[Midtrans] Percobaan ke-${attempts} gagal:`, error.message);
                                if (attempts >= maxAttempts) throw new Error(`Gagal terhubung ke server pembayaran setelah ${maxAttempts} kali percobaan.`);
                                await new Promise(resolve => setTimeout(resolve, 2000));
                            }
                        }

                        const qrCodeUrl = midtransResponse.data.actions.find(a => a.name === 'generate-qr-code').url;
                        const transactions = loadData(transactionsFilePath, {});
                        transactions[orderId] = { userId: senderId, productId: product.id, productName: product.name, quantity: quantity, status: "PENDING", createdAt: new Date().toISOString() };
                        saveData(transactionsFilePath, transactions);

                        const caption = `*🧾 Tagihan Pembayaran*\n\nSilakan scan QRIS di atas untuk membayar. Produk akan otomatis dikirim setelah pembayaran berhasil.\n\n> *PERHATIAN:* Link pembayaran ini akan kedaluwarsa dalam *5 menit*.`;
                        const sentQRMessage = await sock.sendMessage(from, { image: { url: qrCodeUrl }, caption: caption });
                        
                        setTimeout(async () => {
                            const currentTransactions = loadData(transactionsFilePath, {});
                            if (currentTransactions[orderId] && currentTransactions[orderId].status === 'PENDING') {
                                await sock.sendMessage(from, { text: `⌛ *Waktu Habis*\n\nPembayaran untuk pesanan \`${orderId}\` telah kedaluwarsa dan dibatalkan.` });
                                await sock.sendMessage(from, { delete: sentQRMessage.key });
                                delete currentTransactions[orderId];
                                saveData(transactionsFilePath, currentTransactions);
                            }
                        }, 305000);
                        reactionEmoji = '⏳';
                        
                    } else if (lowerBody === 'batal') {
                        await sock.sendMessage(from, { text: "Baik, pesanan telah dibatalkan." });
                        reactionEmoji = '👍';
                    } else {
                        await sock.sendMessage(from, { text: "Pilihan tidak valid. Silakan balas dengan `YA` atau `BATAL`." });
                        return;
                    }
                    delete userState[senderId];
                }
                return;
            }

            // PRIORITAS 2: JIKA ADA PERINTAH BARU, HAPUS STATE LAMA
            if (userState[senderId] && isCmd) {
                console.log(`[State] Pengguna ${senderId} keluar dari state '${userState[senderId].state}' karena ada perintah baru.`);
                clearTimeout(userState[senderId].timeoutId);
                delete userState[senderId];
            }

            // PRIORITAS 3: PROSES PERINTAH ATAU SAPAAN BIASA
            if (isCmd) {
                const command = body.trim().split(/ +/)[0].toLowerCase();
                const args = body.trim().split(/ +/).slice(1);
                
                switch (command) {
                    case '/katalog':
                    case '/produk':
                    case '/menu': {
                        const products = loadData(productsFilePath, []);
                        let catalogMessage = "*🛍️ Katalog Produk - Nusa Karsa ✨*\n\nBalas pesan ini dengan *nomor produk* untuk melihat detailnya.\n";
                        if (products.length === 0) {
                            catalogMessage = "Maaf, saat ini belum ada produk yang tersedia.";
                        } else {
                            products.forEach((product, index) => {
                                catalogMessage += `\n*${index + 1}.* ${product.name}`;
                            });
                            catalogMessage += `\n\n--------------------\nKetik *selesai* atau *keluar* jika sudah selesai melihat-lihat.`;
                            userState[senderId] = { state: 'awaiting_catalog_choice' };
                        }
                        await sock.sendMessage(from, { text: catalogMessage });
                        reactionEmoji = '🛍️';
                        break;
                    }
                    case '/beli': {
                        const products = loadData(productsFilePath, []);
                        const stock = loadData(stockFilePath, {});
                        const [productId, quantityStr] = args;
                        if (!productId) {
                             await sock.sendMessage(from, {text: "Format salah. Gunakan `/beli <ID_PRODUK>`.\nContoh: `/beli NF01`"});
                             reactionEmoji = '❓';
                             break;
                        }
                        const quantity = parseInt(quantityStr) || 1;
                        const product = products.find(p => p.id.toLowerCase() === productId.toLowerCase());

                        if (!product) {
                            await sock.sendMessage(from, { text: `Maaf, produk dengan ID \`${productId}\` tidak ditemukan. Cek kembali \`/katalog\`.` });
                            reactionEmoji = '❌';
                            break;
                        }
                        const availableStock = stock[product.id] ? stock[product.id].length : 0;
                        if (availableStock < quantity) {
                            await sock.sendMessage(from, { text: `Maaf, stok untuk *${product.name}* tidak mencukupi. Sisa stok: ${availableStock}.` });
                            reactionEmoji = '😥';
                            break;
                        }

                        const totalPrice = product.price * quantity;
                        let confirmationMessage = `*🛒 Konfirmasi Pesanan*\n\n`;
                        confirmationMessage += `Anda akan membeli:\n`;
                        confirmationMessage += `> *Produk:* ${product.name}\n`;
                        confirmationMessage += `> *Jumlah:* ${quantity}\n`;
                        confirmationMessage += `> *Total Harga:* Rp ${totalPrice.toLocaleString('id-ID')}\n\n`;
                        confirmationMessage += `*Panduan Pembayaran:*\n> Pembayaran akan menggunakan QRIS yang akan kedaluwarsa dalam 5 menit. Pastikan Anda siap untuk melakukan scan.\n\nBalas dengan *YA* untuk melanjutkan, atau *BATAL* untuk membatalkan.`;
                        
                        const timeoutId = setTimeout(() => {
                            if (userState[senderId] && userState[senderId].state === 'awaiting_purchase_confirmation') {
                                delete userState[senderId];
                                sock.sendMessage(from, { text: "⏳ Waktu konfirmasi habis, pesanan otomatis dibatalkan." });
                            }
                        }, 300000);

                        userState[senderId] = { state: 'awaiting_purchase_confirmation', productId: product.id, quantity: quantity, timeoutId };
                        await sock.sendMessage(from, { text: confirmationMessage });
                        reactionEmoji = '🤔';
                        break;
                    }
                    case '/riwayat': {
                        const transactions = loadData(transactionsFilePath, {});
                        const usersData = loadData(usersFilePath, {});
                        const userTransactions = usersData[senderId]?.transactions || [];
                        let historyMessage = `*📜 Riwayat Transaksi Anda*\n\n`;
                        if (userTransactions.length === 0) {
                            historyMessage += "Anda belum memiliki riwayat transaksi yang berhasil.";
                        } else {
                            userTransactions.forEach(orderId => {
                                const t = transactions[orderId];
                                if (t) {
                                    historyMessage += `--------------------\n`;
                                    historyMessage += `*Produk:* ${t.productName}\n`;
                                    historyMessage += `*Jumlah:* ${t.quantity}\n`;
                                    historyMessage += `*Tanggal:* ${new Date(t.createdAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}\n`;
                                }
                            });
                        }
                        await sock.sendMessage(from, { text: historyMessage });
                        reactionEmoji = '📜';
                        break;
                    }
                    case '/tambahproduk': {
                        if (senderId !== ownerJid) return;
                        const [id, price, ...nameParts] = args;
                        const name = nameParts.join(' ');
                        if (!id || !price || !name || isNaN(parseInt(price))) {
                            await sock.sendMessage(from, { text: "Format salah. Gunakan:\n`/tambahproduk <ID_Unik> <Harga> <Nama Produk>`\nContoh: `/tambahproduk VC01 10000 Voucher Game A`" });
                            reactionEmoji = '❓';
                            break;
                        }
                        const products = loadData(productsFilePath, []);
                        products.push({ id: id.toUpperCase(), name: name, price: parseInt(price), description: "Deskripsi default" });
                        saveData(productsFilePath, products);
                        await sock.sendMessage(from, { text: `✅ Produk *${name}* dengan ID \`${id.toUpperCase()}\` berhasil ditambahkan.` });
                        reactionEmoji = '✨';
                        break;
                    }
                    case '/tambahstok': {
                        if (senderId !== ownerJid) return;
                        const [productId, ...newStockItems] = args;
                        if (!productId || newStockItems.length === 0) {
                            await sock.sendMessage(from, { text: "Format salah. Gunakan:\n`/tambahstok <ID_Produk> <item1> <item2> ...`\nContoh: `/tambahstok NF01 email:pass email2:pass2`" });
                            reactionEmoji = '❓';
                            break;
                        }
                        const stock = loadData(stockFilePath, {});
                        const upperProductId = productId.toUpperCase();
                        if (!stock[upperProductId]) stock[upperProductId] = [];
                        stock[upperProductId].push(...newStockItems);
                        saveData(stockFilePath, stock);
                        await sock.sendMessage(from, { text: `✅ Berhasil! ${newStockItems.length} item baru ditambahkan ke stok \`${upperProductId}\`.` });
                        reactionEmoji = '📦';
                        break;
                    }
                    case '/cekstok': {
                        if (senderId !== ownerJid) return;
                        const products = loadData(productsFilePath, []);
                        const stock = loadData(stockFilePath, {});
                        let stockMessage = "*📦 Laporan Stok Saat Ini*\n\n";
                        products.forEach(p => {
                            const stockCount = stock[p.id] ? stock[p.id].length : 0;
                            stockMessage += `> *${p.name}* (\`${p.id}\`): ${stockCount} item\n`;
                        });
                        await sock.sendMessage(from, { text: stockMessage });
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
                                const productPrice = products.find(p => p.id === t.productId)?.price || 0;
                                stats[t.productId].sold += t.quantity;
                                stats[t.productId].revenue += t.quantity * productPrice;
                                totalRevenue += t.quantity * productPrice;
                            }
                        });
                        const sortedStats = Object.values(stats).sort((a, b) => b.sold - a.sold);
                        let statsMessage = `*📈 Statistik Penjualan - Nusa Karsa*\n\n`;
                        if (sortedStats.length === 0) {
                            statsMessage += "Belum ada produk yang terjual.";
                        } else {
                            statsMessage += `*Produk Terlaris:*\n`;
                            sortedStats.forEach((stat, index) => {
                                statsMessage += `${index + 1}. *${stat.name}*\n   - Terjual: ${stat.sold} unit\n   - Pendapatan: Rp ${stat.revenue.toLocaleString('id-ID')}\n`;
                            });
                            statsMessage += `\n--------------------\n*Total Pendapatan:* Rp ${totalRevenue.toLocaleString('id-ID')}`;
                        }
                        await sock.sendMessage(from, { text: statsMessage });
                        reactionEmoji = '📈';
                        break;
                    }
                    case '/unblock': {
                        if (senderId !== ownerJid) return;
                        const numberToUnblock = args[0];
                        if (!numberToUnblock) {
                            await sock.sendMessage(from, { text: `Gunakan format: \`/unblock <nomor_wa>\`\nContoh: \`/unblock 6281234567890\`` });
                            reactionEmoji = '❓';
                            break;
                        }
                        const targetJid = `${numberToUnblock.replace(/\D/g, '')}@s.whatsapp.net`;
                        let blocked = loadData(blockedFilePath, []);
                        if (!blocked.includes(targetJid)) {
                            await sock.sendMessage(from, { text: `Nomor tersebut tidak ada dalam daftar blokir bot.` });
                            reactionEmoji = '🤔';
                            break;
                        }
                        await sock.updateBlockStatus(targetJid, "unblock");
                        blocked = blocked.filter(jid => jid !== targetJid);
                        saveData(blockedFilePath, blocked);
                        await sock.sendMessage(from, { text: `✅ Berhasil! Blokir untuk @${targetJid.split('@')[0]} telah dibuka.`, mentions: [targetJid] });
                        await sock.sendMessage(targetJid, { text: `Alhamdulillah, blokir Anda telah dibuka oleh Owner. Anda sekarang bisa menggunakan bot ini lagi.` });
                        reactionEmoji = '🔓';
                        break;
                    }
                    default:
                        await sock.sendMessage(from, { text: `Maaf, perintah \`${command}\` tidak dikenali. Ketik \`/katalog\` untuk melihat daftar produk.` });
                        reactionEmoji = '❓';
                        break;
                }
            } else {
                if (!from.endsWith('@g.us')) {
                    if (!greetedUsers.has(senderId)) {
                        await sock.sendMessage(from, { text: `Selamat datang di *Nusa Karsa Digital Store*!\n\nKetik \`/katalog\` untuk melihat produk yang kami jual.` });
                        greetedUsers.add(senderId);
                    }
                }
            }
        } catch (error) {
            console.error("[ERROR UTAMA]", error);
            if (userState[senderId]) delete userState[senderId];
        } finally {
            if (reactionEmoji) {
                try {
                    await sock.sendMessage(from, { react: { text: reactionEmoji, key: msg.key } });
                } catch (e) { /* Abaikan error reaksi */ }
            }
        }
    });
}

// --- SERVER WEBHOOK & KEEP-ALIVE ---
const app = express();
app.use(express.json());

app.get('/', (req, res) => res.send('Nusa Karsa Bot Server is running!'));

app.post('/webhook', async (req, res) => {
    try {
        const notification = req.body;
        console.log('[WEBHOOK] Notifikasi diterima:', JSON.stringify(notification, null, 2));

        const orderId = notification.order_id;
        const transactionStatus = notification.transaction_status;

        if (transactionStatus === 'settlement' || transactionStatus === 'capture') {
            const transactions = loadData(transactionsFilePath, {});
            const orderData = transactions[orderId];

            if (orderData && orderData.status === 'PENDING') {
                const stock = loadData(stockFilePath, {});
                let deliveredItems = [];
                for (let i = 0; i < orderData.quantity; i++) {
                    const item = stock[orderData.productId]?.shift();
                    if (item) deliveredItems.push(item);
                }

                if (deliveredItems.length > 0) {
                    if (sock) {
                        const productMessage = `*✅ Pembayaran Berhasil!*\n\nTerima kasih. Berikut adalah produk yang Anda beli, harap segera amankan:\n\n\`\`\`${deliveredItems.join('\n')}\`\`\``;
                        await sock.sendMessage(orderData.userId, { text: productMessage });
                        
                        const users = loadData(usersFilePath, {});
                        if (users[orderData.userId]) {
                            if (!users[orderData.userId].transactions) users[orderData.userId].transactions = [];
                            users[orderData.userId].transactions.push(orderId);
                            saveData(usersFilePath, users);
                        }
                    } else {
                        console.error("[WEBHOOK ERROR] Koneksi 'sock' tidak tersedia.");
                    }

                    orderData.status = "COMPLETED";
                    saveData(transactionsFilePath, transactions);
                    saveData(stockFilePath, stock);
                    console.log(`[PRODUK TERKIRIM] ${orderData.quantity} item ${orderData.productId} ke ${orderData.userId}`);
                } else {
                    console.error(`[STOK HABIS] Gagal kirim produk untuk Order ID ${orderId}`);
                    if (sock) {
                        await sock.sendMessage(orderData.userId, { text: `Mohon maaf, terjadi masalah: stok produk habis tepat saat pembayaranmu diproses. Silakan hubungi Owner dengan menyertakan ID Pesanan ini untuk penanganan lebih lanjut: \`${orderId}\`` });
                        await sock.sendMessage(`${OWNER_NUMBER}@s.whatsapp.net`, { text: `⚠️ PERHATIAN: Stok habis untuk pesanan ${orderId}` });
                    }
                }
            }
        }
        res.status(200).send('OK');
    } catch (error) {
        console.error("[WEBHOOK ERROR]", error);
        res.status(500).send('Internal Server Error');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[SERVER] Server Webhook berjalan di port ${PORT}`);
    connectToWhatsApp();
});
