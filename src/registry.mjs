// Asks the public package registries whether a dependency is real.

// A short list of very popular names, used only to spot near-miss spellings.
const POPULAR = {
  npm: [
    'react', 'react-dom', 'next', 'vue', 'svelte', 'express', 'lodash', 'axios', 'typescript', 'webpack',
    'vite', 'eslint', 'prettier', 'jest', 'vitest', 'mocha', 'chalk', 'commander', 'yargs', 'dotenv',
    'moment', 'dayjs', 'date-fns', 'uuid', 'zod', 'joi', 'ajv', 'cors', 'body-parser', 'mongoose',
    'sequelize', 'prisma', 'pg', 'mysql2', 'redis', 'ioredis', 'ws', 'socket.io', 'node-fetch', 'got',
    'cheerio', 'puppeteer', 'playwright', 'rxjs', 'tslib', 'debug', 'semver', 'glob', 'rimraf', 'fs-extra',
    'nodemon', 'jsonwebtoken', 'bcrypt', 'bcryptjs', 'passport', 'helmet', 'morgan', 'winston', 'pino',
    'tailwindcss', 'postcss', 'autoprefixer', 'sass', 'styled-components', 'classnames', 'clsx', 'redux',
    'react-redux', 'zustand', 'react-router', 'react-router-dom', '@types/node', '@types/react', 'openai',
    '@anthropic-ai/sdk', 'langchain', 'stripe', 'aws-sdk', 'firebase', 'graphql', 'apollo-server',
    'eslint-plugin-unused-imports', 'esbuild', 'rollup', 'babel-loader', '@babel/core', 'core-js', 'yaml',
    'js-yaml', 'minimist', 'inquirer', 'ora', 'execa', 'cross-env', 'concurrently', 'husky', 'lint-staged',
    'jscodeshift', 'nanoid', 'immer', 'three', 'd3', 'chart.js', 'marked', 'highlight.js', 'sharp', 'multer',
  ],
  pypi: [
    'requests', 'numpy', 'pandas', 'scipy', 'matplotlib', 'seaborn', 'scikit-learn', 'torch', 'tensorflow',
    'keras', 'flask', 'django', 'fastapi', 'uvicorn', 'gunicorn', 'pydantic', 'sqlalchemy', 'alembic',
    'psycopg2', 'psycopg2-binary', 'pymysql', 'redis', 'celery', 'boto3', 'botocore', 'pyyaml', 'toml',
    'click', 'typer', 'rich', 'tqdm', 'pytest', 'pytest-cov', 'black', 'ruff', 'flake8', 'mypy', 'isort',
    'httpx', 'aiohttp', 'beautifulsoup4', 'lxml', 'selenium', 'playwright', 'pillow', 'opencv-python',
    'jinja2', 'markupsafe', 'werkzeug', 'python-dotenv', 'cryptography', 'pyjwt', 'bcrypt', 'paramiko',
    'openai', 'anthropic', 'langchain', 'transformers', 'huggingface-hub', 'datasets', 'tokenizers',
    'setuptools', 'wheel', 'pip', 'six', 'attrs', 'python-dateutil', 'pytz', 'certifi', 'urllib3', 'idna',
    'charset-normalizer', 'protobuf', 'grpcio', 'pyarrow', 'polars', 'jupyter', 'notebook', 'ipython',
    'streamlit', 'gradio', 'pydantic-settings', 'tenacity', 'loguru', 'orjson', 'ujson', 'marshmallow',
  ],
};

export function levenshtein(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

export function nearMiss(ecosystem, name) {
  const list = POPULAR[ecosystem] || [];
  if (list.includes(name)) return null;
  const plain = name.replace(/^@[^/]+\//, '');
  for (const p of list) {
    const target = p.replace(/^@[^/]+\//, '');
    const limit = target.length >= 8 ? 2 : 1;
    if (target.length < 4) continue;
    if (levenshtein(plain, target) <= limit && plain !== target) return p;
  }
  return null;
}

const DAY = 24 * 60 * 60 * 1000;

// Names registered only to block attackers (or by attackers pretending to) carry no real code.
const PLACEHOLDER = /placeholder|dependency confusion|security holding|reserved (?:package )?name|do not (?:use|install)/i;

async function npmWeeklyDownloads(name, fetchImpl) {
  try {
    const res = await fetchImpl(`https://api.npmjs.org/downloads/point/last-week/${name}`, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body?.downloads === 'number' ? body.downloads : null;
  } catch {
    return null; // download counts are a hint; never fail a lookup over them
  }
}

/**
 * Returns { exists, createdAt, ageDays, nearMiss, error }.
 * fetchImpl is injectable so tests never touch the network.
 */
export async function lookupPackage(dep, { fetchImpl = fetch, now = Date.now() } = {}) {
  const result = { exists: null, createdAt: null, ageDays: null, nearMiss: nearMiss(dep.ecosystem, dep.name), placeholder: false, weeklyDownloads: null, error: null };
  try {
    if (dep.ecosystem === 'npm') {
      const url = `https://registry.npmjs.org/${dep.name.replace('/', '%2F')}`;
      const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
      if (res.status === 404) return { ...result, exists: false };
      if (!res.ok) return { ...result, error: `npm registry answered ${res.status}` };
      const body = await res.json();
      result.exists = true;
      result.createdAt = body?.time?.created ?? null;
      const versions = Object.keys(body?.versions ?? {});
      result.placeholder = PLACEHOLDER.test(body?.description ?? '') || (versions.length > 0 && versions.every((v) => v.endsWith('-security')));
      result.weeklyDownloads = await npmWeeklyDownloads(dep.name, fetchImpl);
    } else if (dep.ecosystem === 'pypi') {
      const res = await fetchImpl(`https://pypi.org/pypi/${encodeURIComponent(dep.name)}/json`, { headers: { accept: 'application/json' } });
      if (res.status === 404) return { ...result, exists: false };
      if (!res.ok) return { ...result, error: `PyPI answered ${res.status}` };
      const body = await res.json();
      result.exists = true;
      result.placeholder = PLACEHOLDER.test(`${body?.info?.summary ?? ''}`);
      let earliest = null;
      for (const files of Object.values(body?.releases ?? {})) {
        for (const f of files) {
          const t = f.upload_time_iso_8601 || f.upload_time;
          if (t && (!earliest || t < earliest)) earliest = t;
        }
      }
      result.createdAt = earliest;
    } else {
      return { ...result, error: `unsupported ecosystem ${dep.ecosystem}` };
    }
  } catch (err) {
    return { ...result, error: `registry lookup failed: ${err.message}` };
  }
  if (result.createdAt) result.ageDays = Math.floor((now - Date.parse(result.createdAt)) / DAY);
  return result;
}
