import { real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const plotWeights = sqliteTable("plot_weights", {
  uuid: text("uuid").primaryKey(),
  feid: text("feid").notNull(),
  entityName: text("entity_name").notNull(),
  obsName: text("obs_name").notNull(),
  weight: real("weight").notNull(),
  updatedAt: text("updated_at").notNull(),
});
