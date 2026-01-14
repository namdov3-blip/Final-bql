module.exports = (req, res) => {
    res.status(200).json({
        message: "Debug CJS endpoint is working",
        env: {
            node: process.version,
            hasMongo: !!process.env.MONGODB_URI
        }
    });
};
