// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const multer = require('multer');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');

const app = express();
app.use(cors({ origin: '*' })); // для теста всем разрешаем
app.use(express.json());

// Multer для загрузки файлов
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Подключение к MongoDB
const client = new MongoClient(process.env.MONGODB_URI);
let db;
async function connectDB() {
    await client.connect();
    db = client.db(process.env.DB_NAME || 'testdb');
    console.log('✅ MongoDB connected');
}
connectDB().catch(console.error);

// S3 client (Supabase Storage)
const s3 = new S3Client({
    region: process.env.S3_REGION,
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
    },
    forcePathStyle: true
});

// Create (POST) — загрузка фото
app.post('/photos', upload.single('image'), async (req, res) => {
    try {
        const fileName = crypto.randomBytes(16).toString('hex') + '.' + req.file.originalname.split('.').pop();
        await s3.send(new PutObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: fileName,
            Body: req.file.buffer,
            ContentType: req.file.mimetype
        }));

        const photoDoc = {
            fileName,
            createdAt: new Date()
        };
        const result = await db.collection('photos').insertOne(photoDoc);
        res.json({ id: result.insertedId, ...photoDoc });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Upload failed' });
    }
});

// Read (GET) — получить список фото
app.get('/photos', async (req, res) => {
    const photos = await db.collection('photos').find().toArray();
    res.json(photos);
});

// Update (PUT) — обновить документ
app.put('/photos/:id', async (req, res) => {
    const { id } = req.params;
    const update = req.body;
    await db.collection('photos').updateOne({ _id: new ObjectId(id) }, { $set: update });
    res.json({ message: 'Updated' });
});

// Delete (DELETE) — удалить фото
app.delete('/photos/:id', async (req, res) => {
    const { id } = req.params;
    const photo = await db.collection('photos').findOne({ _id: new ObjectId(id) });
    if (!photo) return res.status(404).json({ error: 'Not found' });

    await s3.send(new DeleteObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: photo.fileName
    }));

    await db.collection('photos').deleteOne({ _id: new ObjectId(id) });
    res.json({ message: 'Deleted' });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
