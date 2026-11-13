-- Blend recommendations moved to the server: api/blends/recommendations.js
-- scores them in JavaScript (src/features/blends/blendRecs.js) so it can add
-- TMDb discoveries, which SQL can't fetch. It reads members' rankings with
-- the service role and returns only group-level facts, same rule as before.

drop function public.get_blend_recommendations(uuid, integer);
