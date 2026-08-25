/**
 * Idempotent development seed.
 *
 * Creates a platform super admin, one demo organization and two users inside
 * it. Running it twice changes nothing.
 *
 *   npm run seed
 */
import { existsSync } from "node:fs";
import path from "node:path";

// Next loads .env.local for us at runtime; a standalone script has to do it.
for (const file of [".env.local", ".env"]) {
  const full = path.resolve(process.cwd(), file);
  if (existsSync(full)) {
    process.loadEnvFile(full);
    break;
  }
}

import { connectToDatabase, disconnectFromDatabase } from "../src/lib/mongodb";
import { hashPassword } from "../src/lib/crypto";
import { Organization } from "../src/models/Organization";
import { User } from "../src/models/User";
import { ROLES } from "../src/types";
import { slugify } from "../src/modules/organization/organization.util";

async function upsertUser(params: {
  email: string;
  password: string;
  name: string;
  role: (typeof ROLES)[keyof typeof ROLES];
  organizationId: string | null;
}) {
  const existing = await User.findOne({ email: params.email }).lean();
  if (existing) {
    console.log(`  = user ${params.email} already exists`);
    return existing._id;
  }
  const user = await User.create({
    email: params.email,
    name: params.name,
    role: params.role,
    organizationId: params.organizationId,
    passwordHash: await hashPassword(params.password),
    status: "ACTIVE",
  });
  console.log(`  + user ${params.email} (${params.role})`);
  return user._id;
}

async function main() {
  await connectToDatabase();

  const orgName = process.env.SEED_ORG_NAME ?? "Acme Logistics";
  const slug = slugify(orgName);

  let organization = await Organization.findOne({ slug });
  if (!organization) {
    organization = await Organization.create({
      name: orgName,
      slug,
      status: "ACTIVE",
      settings: { smsEnabled: false },
    });
    console.log(`  + organization ${orgName} (${slug})`);
  } else {
    console.log(`  = organization ${orgName} already exists`);
  }

  await upsertUser({
    email: process.env.SEED_SUPER_ADMIN_EMAIL ?? "superadmin@example.com",
    password: process.env.SEED_SUPER_ADMIN_PASSWORD ?? "SuperAdmin123!",
    name: "Platform Super Admin",
    role: ROLES.SUPER_ADMIN,
    organizationId: null,
  });

  await upsertUser({
    email: process.env.SEED_ORG_ADMIN_EMAIL ?? "admin@acme.test",
    password: process.env.SEED_ORG_ADMIN_PASSWORD ?? "OrgAdmin123!",
    name: "Acme Administrator",
    role: ROLES.ORGANIZATION_ADMIN,
    organizationId: String(organization._id),
  });

  await upsertUser({
    email: process.env.SEED_ORG_MEMBER_EMAIL ?? "member@acme.test",
    password: process.env.SEED_ORG_MEMBER_PASSWORD ?? "OrgMember123!",
    name: "Acme Member",
    role: ROLES.ORGANIZATION_MEMBER,
    organizationId: String(organization._id),
  });

  console.log("\nSeed complete.\n");
  console.log("  Super admin :", process.env.SEED_SUPER_ADMIN_EMAIL ?? "superadmin@example.com");
  console.log("  Org admin   :", process.env.SEED_ORG_ADMIN_EMAIL ?? "admin@acme.test");
  console.log("  Org member  :", process.env.SEED_ORG_MEMBER_EMAIL ?? "member@acme.test");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectFromDatabase();
  });
