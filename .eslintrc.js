/**
 * @type {import('@types/eslint').ESLint.ConfigData}
 */
module.exports = {
	root: true,

	env: {
		browser: true,
		es6: true,
		node: true,
	},

	parser: '@typescript-eslint/parser',

	parserOptions: {
		project: ['./tsconfig.json'],
		sourceType: 'module',
	},

	ignorePatterns: ['.eslintrc.js', 'gulpfile.js', 'index.js', '**/*.js', 'node_modules/**', 'dist/**'],

	overrides: [
		{
			files: ['./credentials/**/*.ts'],
			plugins: ['eslint-plugin-n8n-nodes-base'],
			extends: ['plugin:n8n-nodes-base/credentials'],
			rules: {
				// Conflicts with cred-class-field-documentation-url-not-http-url:
				// we use a full HTTPS docs URL, which that rule requires.
				'n8n-nodes-base/cred-class-field-documentation-url-miscased': 'off',
			},
		},
		{
			files: ['./nodes/**/*.ts'],
			plugins: ['eslint-plugin-n8n-nodes-base'],
			extends: ['plugin:n8n-nodes-base/nodes'],
			rules: {
				// Modern n8n (1.x/2.x) expects NodeConnectionTypes.Main; keep that form.
				'n8n-nodes-base/node-class-description-outputs-wrong': 'off',
			},
		},
	],
};
