import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ITransactionLog {
    timestamp: Date;
    action: string;
    details: string;
    totalAmount?: number;
    actor?: string;
}

export interface IHousehold {
    id: string;
    name: string;
    cccd: string;
    address: string;
    landOrigin: string;
    landArea: number;
    decisionNumber: string;
    decisionDate: Date;
}

export interface ICompensation {
    landAmount: number;
    assetAmount: number;
    houseAmount: number;
    supportAmount: number;
    totalApproved: number;
}

export interface ITransaction extends Document {
    projectId: Types.ObjectId;
    household: IHousehold;
    compensation: ICompensation;
    status: 'Chưa giải ngân' | 'Đã giải ngân' | 'Tồn đọng/Giữ hộ';
    disbursementDate?: Date;
    effectiveInterestDate?: Date;
    supplementaryAmount?: number;
    supplementaryNote?: string;
    notes?: string;
    history: ITransactionLog[];
    updatedAt: Date;
}

const TransactionLogSchema = new Schema<ITransactionLog>({
    timestamp: { type: Date, default: Date.now },
    action: { type: String, required: true },
    details: { type: String, required: true },
    totalAmount: { type: Number },
    actor: { type: String }
}, { _id: false });

const HouseholdSchema = new Schema<IHousehold>({
    id: { type: String, required: true },
    name: { type: String, required: true },
    cccd: { type: String, required: true },
    address: { type: String, default: '' },
    landOrigin: { type: String, default: '' },
    landArea: { type: Number, default: 0 },
    decisionNumber: { type: String, default: '' },
    decisionDate: { type: Date }
}, { _id: false });

const CompensationSchema = new Schema<ICompensation>({
    landAmount: { type: Number, default: 0 },
    assetAmount: { type: Number, default: 0 },
    houseAmount: { type: Number, default: 0 },
    supportAmount: { type: Number, default: 0 },
    totalApproved: { type: Number, required: true }
}, { _id: false });

const TransactionSchema = new Schema<ITransaction>({
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    household: { type: HouseholdSchema, required: true },
    compensation: { type: CompensationSchema, required: true },
    status: {
        type: String,
        enum: ['Chưa giải ngân', 'Đã giải ngân', 'Tồn đọng/Giữ hộ'],
        default: 'Chưa giải ngân'
    },
    disbursementDate: { type: Date },
    effectiveInterestDate: { type: Date },
    supplementaryAmount: { type: Number, default: 0 },
    notes: { type: String },
    history: { type: [TransactionLogSchema], default: [] }
}, { timestamps: true });

// Index for faster queries
TransactionSchema.index({ projectId: 1 });
TransactionSchema.index({ status: 1 });
TransactionSchema.index({ 'household.name': 'text' });
TransactionSchema.index({ updatedAt: -1 });

// Ensure virtual fields (like id) are serialized and _id is removed
TransactionSchema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: function (doc, ret) {
        if (ret._id) {
            ret.id = ret._id.toString();
            delete ret._id;
        }
        return ret;
    }
});

TransactionSchema.set('toObject', {
    virtuals: true,
    versionKey: false,
    transform: function (doc, ret) {
        if (ret._id) {
            ret.id = ret._id.toString();
            delete ret._id;
        }
        return ret;
    }
});

export default mongoose.models.Transaction || mongoose.model<ITransaction>('Transaction', TransactionSchema);
