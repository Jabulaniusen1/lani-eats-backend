-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveryCode" TEXT;

-- AlterTable
ALTER TABLE "Rider" ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "homeAddress" TEXT,
ADD COLUMN     "isOnboarded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nin" TEXT,
ADD COLUMN     "photographUrl" TEXT;
