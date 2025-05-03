-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "from" TEXT,
    "from_point_change" INTEGER NOT NULL,
    "to" TEXT,
    "to_point_change" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "commitId" TEXT,
    CONSTRAINT "Transaction_commitId_fkey" FOREIGN KEY ("commitId") REFERENCES "MerkleCommit" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MerkleCommit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rootHash" TEXT NOT NULL,
    "label" INTEGER NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "committed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MerkleProof" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "txId" TEXT NOT NULL,
    "commitId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "sibling" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    CONSTRAINT "MerkleProof_txId_fkey" FOREIGN KEY ("txId") REFERENCES "Transaction" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MerkleProof_commitId_fkey" FOREIGN KEY ("commitId") REFERENCES "MerkleCommit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
