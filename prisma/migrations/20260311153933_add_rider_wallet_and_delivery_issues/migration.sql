-- CreateEnum
CREATE TYPE "DeliveryIssueType" AS ENUM ('CANT_FIND_CUSTOMER', 'WRONG_ADDRESS', 'CUSTOMER_REFUSED', 'ITEM_DAMAGED', 'RESTAURANT_NOT_READY', 'OTHER');

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "photoProofUrl" TEXT;

-- AlterTable
ALTER TABLE "Rider" ADD COLUMN     "totalDeclined" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "RiderBankAccount" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "bankCode" TEXT NOT NULL,
    "recipientCode" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderBankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderPayoutRequest" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "reference" TEXT,
    "narration" TEXT,
    "failureReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "RiderPayoutRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryIssue" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "type" "DeliveryIssueType" NOT NULL,
    "description" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RiderBankAccount_riderId_key" ON "RiderBankAccount"("riderId");

-- AddForeignKey
ALTER TABLE "RiderBankAccount" ADD CONSTRAINT "RiderBankAccount_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderPayoutRequest" ADD CONSTRAINT "RiderPayoutRequest_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryIssue" ADD CONSTRAINT "DeliveryIssue_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryIssue" ADD CONSTRAINT "DeliveryIssue_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
