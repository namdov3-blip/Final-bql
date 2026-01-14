const mongoose = require('mongoose');

const uri = "mongodb+srv://tuanasish:123456aa@tuanasishh.olosu0a.mongodb.net/quanlygiaodich";

async function run() {
    try {
        await mongoose.connect(uri);
        console.log("Connected to MongoDB");

        const Transaction = mongoose.model('Transaction', new mongoose.Schema({
            compensation: {
                totalApproved: Number
            },
            household: {
                name: String
            }
        }), 'transactions');

        const count = await Transaction.countDocuments();
        console.log(`Total Transactions: ${count}`);

        const sample = await Transaction.find().sort({ _id: -1 }).limit(10);
        console.log("Last 10 transactions:");
        sample.forEach(t => {
            console.log(`- ${t.household?.name}: ${t.compensation?.totalApproved}`);
        });

        const zeroCount = await Transaction.countDocuments({ "compensation.totalApproved": { $lte: 0 } });
        console.log(`Transactions with zero or negative amount: ${zeroCount}`);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

run();
