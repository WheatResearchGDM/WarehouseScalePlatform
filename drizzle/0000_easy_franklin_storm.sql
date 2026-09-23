CREATE TABLE `plot_weights` (
	`uuid` text PRIMARY KEY NOT NULL,
	`feid` text NOT NULL,
	`entity_name` text NOT NULL,
	`obs_name` text NOT NULL,
	`weight` real NOT NULL,
	`updated_at` text NOT NULL
);
