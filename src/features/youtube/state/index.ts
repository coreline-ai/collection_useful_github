export type YoutubeFeatureState = {
  initializedAt: string
}

export const createYoutubeInitialState = (): YoutubeFeatureState => ({
  initializedAt: new Date().toISOString(),
})
