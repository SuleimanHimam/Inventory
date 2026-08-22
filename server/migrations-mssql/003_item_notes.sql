-- A free-text note on an item's own card — supplier terms, storage
-- instructions, anything that doesn't fit a structured column.
ALTER TABLE items ADD notes nvarchar(max) NULL;
GO
