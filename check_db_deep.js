const mongoose = require('mongoose');

const uri = "mongodb+srv://tuanasish:123456aa@tuanasishh.olosu0a.mongodb.net/quanlygiaodich";

async function run() {
    try {
        await mongoose.connect(uri);
        console.log("Connected to MongoDB");

        const Transaction = mongoose.model('Transaction', new mongoose.Schema({
            projectId: mongoose.Schema.Types.ObjectId,
            household: Object,
            compensation: Object,
            amount: Number // Checking if accidental flat field exists
        }), 'transactions');

        const Project = mongoose.model('Project', new mongoose.Schema({
            code: String,
            name: String,
            totalBudget: Number
        }), 'projects');

        const txs = await Transaction.find().sort({ _id: -1 }).limit(20);
        console.log("\n--- TRANSACTION SAMPLES ---");
        txs.forEach(t => {
            console.log(`Name: ${t.household?.name}`);
            console.log(`  projectId: ${t.projectId}`);
            console.log(`  compensation.totalApproved: ${t.compensation?.totalApproved} (Type: ${typeof t.compensation?.totalApproved})`);
            console.log(`  Flat amount field (if exists): ${t.amount}`);
        });

        const projectSummary = await Project.find();
        console.log("\n--- PROJECT SUMMARY ---");
        projectSummary.forEach(p => {
            console.log(`Project: ${p.name} (${p.code}) | ID: ${p._id}`);
            console.log(`  Total Budget: ${p.totalBudget}`);
        });

        const zeroTotalApproved = await Transaction.countDocuments({ "compensation.totalApproved": 0 });
        const missingTotalApproved = await Transaction.countDocuments({ "compensation.totalApproved": { $exists: false } });
        console.log(`\nStats: Zero=${zeroTotalApproved}, Missing=${missingTotalApproved}, Total=${await Transaction.countDocuments()}`);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

run();
