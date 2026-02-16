export type BookmarkFeatureState = {
  initializedAt: string
}

export const createBookmarkInitialState = (): BookmarkFeatureState => ({
  initializedAt: new Date().toISOString(),
})
