package com.yassinabdelaziz.ystream.data

import com.yassinabdelaziz.ystream.BuildConfig
import com.yassinabdelaziz.ystream.data.model.CreditsDto
import com.yassinabdelaziz.ystream.data.model.DetailsDto
import com.yassinabdelaziz.ystream.data.model.MediaListResponse
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.GET
import retrofit2.http.Path
import retrofit2.http.Query
import java.util.concurrent.TimeUnit

/**
 * Client for the yStream TMDB API. All data comes through the site's Cloudflare
 * worker proxy (same "source of truth" the website uses) so the app needs no
 * API keys and stays in sync with the site.
 */
interface TmdbApi {

    @GET("trending/{mediaType}/week")
    suspend fun trending(
        @Path("mediaType") mediaType: String,
        @Query("page") page: Int = 1
    ): MediaListResponse

    @GET("search/{mediaType}")
    suspend fun search(
        @Path("mediaType") mediaType: String,
        @Query("query") query: String,
        @Query("page") page: Int = 1
    ): MediaListResponse

    @GET("{mediaType}/{id}")
    suspend fun details(
        @Path("mediaType") mediaType: String,
        @Path("id") id: Long
    ): DetailsDto

    @GET("{mediaType}/{id}/recommendations")
    suspend fun recommendations(
        @Path("mediaType") mediaType: String,
        @Path("id") id: Long,
        @Query("page") page: Int = 1
    ): MediaListResponse

    @GET("{mediaType}/{id}/similar")
    suspend fun similar(
        @Path("mediaType") mediaType: String,
        @Path("id") id: Long,
        @Query("page") page: Int = 1
    ): MediaListResponse

    @GET("{mediaType}/{id}/credits")
    suspend fun credits(
        @Path("mediaType") mediaType: String,
        @Path("id") id: Long
    ): CreditsDto

    companion object {
        fun create(): TmdbApi {
            val logging = HttpLoggingInterceptor().apply {
                level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BASIC
                else HttpLoggingInterceptor.Level.NONE
            }
            val client = OkHttpClient.Builder()
                .connectTimeout(20, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .addInterceptor { chain ->
                    val request = chain.request().newBuilder()
                        .header("Accept", "application/json")
                        .header(
                            "User-Agent",
                            "yStream-Android/1.0 (Mobile)"
                        )
                        .build()
                    chain.proceed(request)
                }
                .addInterceptor(logging)
                .build()

            return Retrofit.Builder()
                .baseUrl(BuildConfig.API_BASE + "/")
                .client(client)
                .addConverterFactory(GsonConverterFactory.create())
                .build()
                .create(TmdbApi::class.java)
        }
    }
}
