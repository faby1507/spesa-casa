// api.mjs — Netlify Function (ESM) alla radice
import { neon } from '@neondatabase/serverless';

const conn = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;
if (!conn) throw new Error('Missing NETLIFY_DATABASE_URL');
const sql = neon(conn);

// Crea tabelle se non esistono
let initialized = false;
async function ensureSchema() {
  if (initialized) return;
  await sql/*sql*/`
    create table if not exists roommates (
      id bigserial primary key,
      household text not null,
      name text not null,
      unique(household, name)
    );
    create table if not exists expenses (
      id bigserial primary key,
      household text not null,
      payer text not null,
      name text not null,
      amount numeric(12,2) not null,
      created_at timestamptz not null default now()
    );
  `;
  initialized = true;
}

function j(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

export default async (req, context) => {
  await ensureSchema();

  const url = new URL(req.url);
  const hid = url.searchParams.get('hid') || 'default';
  const splat = context.params?.splat || ''; // "state", "expense-add", ...

  // --- diagnostica rapida
  if (req.method === 'GET' && (splat === 'ping' || splat === '')) {
    return j({ ok: true, hid, message: 'Function up & DB ready' });
  }

  // --- lettura stato
  if (req.method === 'GET' && splat === 'state') {
    const roommates = await sql/*sql*/`
      select name from roommates where household = ${hid} order by name asc
    `;
    const expenses = await sql/*sql*/`
      select id, payer, name, cast(amount as float) as amount, created_at
      from expenses
      where household = ${hid}
      order by id asc
    `;
    return j({ roommates: roommates.map(r => r.name), expenses });
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));

    if (splat === 'roommate-add') {
      const { name } = body;
      if (!name) return j({ error: 'name required' }, 400);
      await sql/*sql*/`
        insert into roommates (household, name)
        values (${hid}, ${name})
        on conflict (household, name) do nothing
      `;
      return j({ ok: true });
    }

    if (splat === 'roommate-rename') {
      const { oldName, newName } = body;
      if (!oldName || !newName) return j({ error: 'oldName/newName required' }, 400);
      await sql/*sql*/`
        update roommates set name = ${newName}
        where household = ${hid} and name = ${oldName}
      `;
      await sql/*sql*/`
        update expenses set payer = ${newName}
        where household = ${hid} and payer = ${oldName}
      `;
      return j({ ok: true });
    }

    if (splat === 'roommate-remove') {
      const { name } = body;
      if (!name) return j({ error: 'name required' }, 400);
      await sql/*sql*/`
        delete from roommates where household = ${hid} and name = ${name}
      `;
      return j({ ok: true });
    }

    if (splat === 'expense-add') {
      const { payer, name, amount } = body;
      if (!payer || !name || !(amount > 0)) return j({ error: 'invalid expense' }, 400);
      await sql/*sql*/`
        insert into roommates (household, name)
        values (${hid}, ${payer})
        on conflict (household, name) do nothing
      `;
      const rows = await sql/*sql*/`
        insert into expenses (household, payer, name, amount)
        values (${hid}, ${payer}, ${name}, ${amount})
        returning id
      `;
      return j({ id: rows[0].id });
    }

    if (splat === 'expense-delete') {
      const { id } = body;
      if (!id) return j({ error: 'id required' }, 400);
      await sql/*sql*/`
        delete from expenses where household = ${hid} and id = ${id}
      `;
      return j({ ok: true });
    }
  }

  if (req.method === 'OPTIONS') return new Response('', { status: 204 });
  return new Response('Not Found', { status: 404 });
};
