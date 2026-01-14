import { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
    return res.status(200).json({
        message: "Debug endpoint is working",
        time: new Date().toISOString(),
        env: {
            node: process.version,
            hasMongo: !!process.env.MONGODB_URI
        }
    });
}
