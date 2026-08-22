-- Third role: CLERK ("موظف إخراج", outbound clerk).
--
-- Its whole job is one screen: entering stock-out invoices through the item
-- search. It sees an item's sale price there — display-only, never editable —
-- and nothing else money-shaped; the dashboard and the invoice list are
-- blocked outright rather than just hidden in the UI. See lib/roles.js
-- (canSeeSalePrice, requireNotClerk) for how the two halves of that are
-- enforced at the API.
--
-- No explicit constraint name was given when the column was created, so SQL
-- Server generated one — found by column rather than guessed, the same way
-- the earlier password migration would have had to if it touched a
-- constrained column.

DECLARE @constraint_name nvarchar(200);
SELECT @constraint_name = cc.name
FROM sys.check_constraints cc
JOIN sys.columns col
  ON col.object_id = cc.parent_object_id AND col.column_id = cc.parent_column_id
WHERE cc.parent_object_id = OBJECT_ID('memberships') AND col.name = 'role';

IF @constraint_name IS NOT NULL
  EXEC('ALTER TABLE memberships DROP CONSTRAINT ' + @constraint_name);

ALTER TABLE memberships ADD CONSTRAINT CK_memberships_role
  CHECK (role IN ('OWNER', 'MEMBER', 'CLERK'));
GO
