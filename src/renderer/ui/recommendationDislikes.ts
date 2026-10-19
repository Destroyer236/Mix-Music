// Recommendations and ordinary playback must use the same saved-rule matcher.
export { createDislikeFilter as createRecommendationDislikeFilter } from '@common/dislike'
export { hasDislike as isRecommendationDisliked } from '@renderer/store/dislikeList/action'
