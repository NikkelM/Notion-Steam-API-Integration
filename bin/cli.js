#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Command } from 'commander';

import { loadConfig, validateConfig, saveConfigToFile, describeGameProperties } from '../js/utils.js';
import { runWizard } from '../js/wizard.js';
import { buildConfig, usedBuildingFlags, parseInterval } from '../js/cliConfig.js';

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));

const program = new Command();

program
	.name('notion-steam-api-integration')
	.description('Watch a Notion database for Steam App IDs and fill in game data from the Steam API, driven by a config.json.')
	.version(pkg.version);

program
	.command('run', { isDefault: true })
	.description('Start the integration using a config file, or entirely from flags')
	.option('-c, --config <path>', 'path to a config.json (defaults to ./config.json)')
	.option('--database-id <id>', 'Notion database ID - enables flag-driven mode, no config.json needed')
	.option('--data-source-id <id>', 'Notion data source ID (only for databases with multiple data sources)')
	.option('--interval <ms>', 'how often to check the database for changes, in milliseconds (min 60000; flag-driven mode)', parseInterval)
	.option('--app-id-property <name>', 'name of the Notion property that holds the Steam App ID (flag-driven mode)')
	.option('--steam-account-name <name>', 'Steam account name, enabling tag fetching (password via the STEAM_PASSWORD env var; flag-driven mode)')
	.option('--force-reset', 'reset the local database and refresh every game on start (flag-driven mode)')
	.option('--always-update', 'also re-update entries edited by someone other than the integration (flag-driven mode)')
	.option('--db-path <path>', 'where to store the local database (overrides databasePath; default: the OS-native per-user data directory)')
	.option('--save-config [path]', 'also write the assembled configuration to a file for reuse (default: config.json; flag-driven mode)')
	.addHelpText('after', '\nProvide a config.json (in the current directory or via --config), or build one from flags with --database-id (game properties use their defaults).\nRun "notion-steam-api-integration properties" to see the default Notion columns to create, or "notion-steam-api-integration init" to create a config interactively. See the README and config.schema.json for every option.')
	.action(async (options, command) => {
		// Build the config entirely from flags when config-building flags are used (and no explicit --config file)
		if (!options.config && usedBuildingFlags(command)) {
			// Flags take precedence over a config.json; warn if one is present so its silent omission is never a surprise
			if (fs.existsSync('config.json')) {
				console.warn('Warning: building flags were provided, so the "config.json" in this directory is being ignored. Pass --config config.json to use that file instead, or drop the building flags.');
			}
			const config = buildConfig(options);
			validateConfig(config);
			// Persist before running, so the secret (resolved during run) is never written to the file
			if (options.saveConfig) {
				await saveConfigToFile(config, options.saveConfig === true ? 'config.json' : options.saveConfig, ['notionIntegrationKey']);
			}
			// Import the core (and its steam-user dependency) lazily so --version/--help/init/properties stay fast
			const { run } = await import('../js/notionSteamIntegration.js');
			await run(config);
			return;
		}
		// Start the interactive wizard when invoked with no options and no config to load, but only in an interactive shell so scripts still get the friendly no-config error
		if (!options.config && !fs.existsSync('config.json') && process.stdin.isTTY) {
			await runWizard('config.json');
			return;
		}
		const config = loadConfig(options.config);
		// A --db-path on the run command overrides the config's databasePath (and points a config-less run at a specific location)
		if (options.dbPath) {
			config.databasePath = options.dbPath;
		}
		const { run } = await import('../js/notionSteamIntegration.js');
		await run(config);
	});

program
	.command('init')
	.description('Interactively create a configuration file')
	.option('-o, --output <path>', 'where to write the configuration file', 'config.json')
	.action(async (options) => {
		await runWizard(options.output);
	});

program
	.command('properties')
	.description('List the default Notion columns (and their types) the integration fills in, to help you build your database')
	.action(() => {
		console.log(describeGameProperties());
	});

program.showHelpAfterError('(run with --help to see available commands)');

try {
	await program.parseAsync(process.argv);
} catch (error) {
	console.error('Error: ' + (error?.message ?? error));
	process.exit(1);
}
