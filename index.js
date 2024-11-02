// index.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/downloads', express.static('downloads'));

// Buat folder downloads jika belum ada
if (!fs.existsSync('downloads')) {
    fs.mkdirSync('downloads');
}

// Fungsi untuk mendapatkan token TikTok
async function getTikTokToken(url) {
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Cookie': 'tt_webid_v2=RandomString',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            },
            maxRedirects: 5
        });
        
        return response.headers['set-cookie']?.join('; ') || '';
    } catch (error) {
        console.error('Error getting TikTok token:', error.message);
        return '';
    }
}

// Fungsi untuk mendapatkan info video TikTok
async function getTikTokVideoInfo(url) {
    try {
        // Dapatkan token terlebih dahulu
        const cookie = await getTikTokToken(url);
        
        // Buat headers dengan token
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Connection': 'keep-alive',
            'Cookie': cookie,
            'Referer': 'https://www.tiktok.com/'
        };

        // Ambil halaman video
        const response = await axios.get(url, { 
            headers,
            maxRedirects: 5
        });

        // Cari URL video dengan beberapa pattern
        const patterns = [
            /"playAddr":"([^"]+)"/,
            /"downloadAddr":"([^"]+)"/,
            /{"url":"([^"]+)"}.*?"download_url"/,
            /"playAddr":{"url_list":\["([^"]+)"\]/
        ];

        let videoUrl;
        for (const pattern of patterns) {
            const match = response.data.match(pattern);
            if (match && match[1]) {
                videoUrl = decodeURIComponent(match[1].replace(/\\u002F/g, '/'));
                break;
            }
        }

        if (!videoUrl) {
            throw new Error('Video URL not found in response');
        }

        // Cari judul video
        const titleMatch = response.data.match(/"desc":"([^"]+)"/) || 
                         response.data.match(/<title>(.*?)<\/title>/);
        const title = titleMatch ? titleMatch[1] : 'tiktok-video';

        return {
            videoUrl,
            title: title.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 50),
            cookie
        };
    } catch (error) {
        console.error('Error getting video info:', error);
        throw new Error(`Failed to get video info: ${error.message}`);
    }
}

// Endpoint untuk mengunduh video
app.post('/api/download', async (req, res) => {
    try {
        const { url } = req.body;
        console.log('Downloading video from:', url);

        if (!url || !url.includes('tiktok.com')) {
            throw new Error('Invalid TikTok URL');
        }

        const { videoUrl, title, cookie } = await getTikTokVideoInfo(url);
        console.log('Video URL found:', videoUrl);

        // Generate nama file unik
        const fileName = `${title}-${crypto.randomBytes(4).toString('hex')}.mp4`;
        const filePath = path.join('downloads', fileName);

        // Download video dengan cookie
        const response = await axios({
            method: 'GET',
            url: videoUrl,
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Referer': 'https://www.tiktok.com/',
                'Cookie': cookie
            },
            maxRedirects: 5
        });

        // Simpan video ke file
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                res.json({
                    success: true,
                    downloadUrl: `/downloads/${fileName}`,
                    fileName: fileName
                });
                resolve();
            });
            writer.on('error', (error) => {
                console.error('Error writing file:', error);
                reject(error);
            });
        });

    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Cleanup routine untuk file lama
function cleanOldFiles() {
    const downloadDir = 'downloads';
    const files = fs.readdirSync(downloadDir);
    const now = Date.now();
    
    files.forEach(file => {
        const filePath = path.join(downloadDir, file);
        const stats = fs.statSync(filePath);
        if (now - stats.ctimeMs > 3600000) {
            fs.unlinkSync(filePath);
        }
    });
}

setInterval(cleanOldFiles, 3600000);

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    cleanOldFiles();
});