import Database from 'better-sqlite3';
import { resolve } from 'node:path';

try {
  console.log('Testing a brand new, empty database...');
  const testDb = new Database(resolve('./data/test-empty.db'));
  testDb.close();
  console.log('✅ Empty database opened safely! (better-sqlite3 is working perfectly)');
} catch (err) {
  console.error('❌ Failed on empty database. better-sqlite3 is fundamentally broken on this Pi:', err.message);
  process.exit(1);
}

try {
  console.log('\nTesting your transferred kitchen.db...');
  const kitchenDb = new Database(resolve('./data/kitchen.db'));
  kitchenDb.close();
  console.log('✅ Transferred database opened safely!');
} catch (err) {
  console.error('❌ Failed on kitchen.db:', err.message);
}
