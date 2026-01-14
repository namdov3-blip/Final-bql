const mongoose = require('mongoose');
const MONGODB_URI = 'mongodb+srv://tuanasish:123456aa@tuanasishh.olosu0a.mongodb.net/quanlygiaodich';

async function debug() {
    await mongoose.connect(MONGODB_URI);
    const Project = mongoose.model('Project', new mongoose.Schema({}, { strict: false }));
    const Transaction = mongoose.model('Transaction', new mongoose.Schema({}, { strict: false }));

    const p = await Project.findOne({}).sort({ uploadDate: -1 });
    if (!p) { console.log('NO_PROJECTS'); process.exit(0); }

    const count = await Transaction.countDocuments({ projectId: p._id });
    const sum = await Transaction.aggregate([
        { $match: { projectId: p._id } },
        { $group: { _id: null, total: { $sum: '$compensation.totalApproved' } } }
    ]);

    console.log(`RESULT: PROJECT_ID=${p._id} CODE=${p.code} BUDGET=${p.totalBudget} TX_COUNT=${count} SUM_APPROVED=${sum[0]?.total || 0}`);

    const sample = await Transaction.findOne({ projectId: p._id });
    console.log(`SAMPLE: NAME=${sample?.household?.name} AMT=${sample?.compensation?.totalApproved}`);

    await mongoose.disconnect();
}
debug().catch(console.error);
