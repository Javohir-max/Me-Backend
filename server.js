// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const multer = require('multer');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// Multer для загрузки в память
const storage = multer.memoryStorage();
const upload = multer({ storage });

// MongoDB
const client = new MongoClient(process.env.MONGODB_URI);
let db;
async function connectDB() {
    await client.connect();
    db = client.db(process.env.DB_NAME || 'testdb');

    // Коллекция для автоинкремента
    await db.collection('counters').updateOne({ _id: "photoid" }, { $setOnInsert: { seq: 0 } }, { upsert: true });

    console.log('✅ MongoDB connected');
}
connectDB().catch(console.error);

// S3 (Supabase Storage)
const s3 = new S3Client({
    region: process.env.S3_REGION,
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
    },
    forcePathStyle: true
});

// Генерация публичного URL
function getPublicUrl(fileName) {
    return `https://${process.env.SUPABASE_PROJECT}.supabase.co/storage/v1/object/public/${process.env.S3_BUCKET}/${fileName}`;
}

// Автоинкремент ID
async function getNextId() {
    const counter = await db.collection('counters').findOneAndUpdate(
        { _id: "photoid"}, 
        { $inc: { seq: 1 } }, 
        { returnDocument: 'after', upsert: true }
    );
    if (!result.value) {
        await db.collection('counters').insertOne({ _id: sequenceName, seq: 1 })
        return 1
    }

    return counter.value.seq;
}

// === POST — загрузка фото ===
app.post('/photos', upload.single('image'), async(req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Нет файла' });
        }

        const fileName = Date.now() + '-' + req.file.originalname;

        await s3.send(new PutObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: fileName,
            Body: req.file.buffer,
            ContentType: req.file.mimetype
        }));

        const newId = await getNextId();
        console.log(newId);

        const createdAt = new Date();

        const photo = {
            id: newId,
            name: req.body.name || null,
            fileName,
            url: getPublicUrl(fileName),
            date: createdAt
        };

        await db.collection('photos').insertOne(photo);

        res.json(photo);

    } catch (err) {
        console.error('❌ Ошибка при загрузке фото:', err);
        res.status(500).json({ error: 'Ошибка сервера', details: err.message });
    }
});

// === GET — список фото ===
app.get('/photos', async(req, res) => {
    const photos = await db.collection('photos').find().toArray();

    const formatted = photos.map(p => ({
        id: p.id,
        name: p.name,
        url: getPublicUrl(p.fileName),
        date: p.date
    }));

    res.json(formatted);
});

// === PUT — обновление названия ===
app.put('/photos/:id', async(req, res) => {
    const { id } = req.params;
    const { name } = req.body;

    const result = await db.collection('photos').findOneAndUpdate({ id: parseInt(id) }, { $set: { name } }, { returnDocument: "after" });

    if (!result.value) return res.status(404).json({ error: "Not found" });

    res.json({
        id: result.value.id,
        name: result.value.name,
        url: getPublicUrl(result.value.fileName),
        date: result.value.date
    });
});

// === DELETE — удаление ===
app.delete('/photos/:id', async(req, res) => {
    const { id } = req.params;
    const photo = await db.collection('photos').findOne({ id: parseInt(id) });
    if (!photo) return res.status(404).json({ error: 'Not found' });

    await s3.send(new DeleteObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: photo.fileName
    }));

    await db.collection('photos').deleteOne({ id: parseInt(id) });
    res.json({ message: 'Deleted' });
});

// === Запуск сервера ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));