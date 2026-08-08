package com.songcai.utils;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.util.Date;
import java.util.Map;

/**
 * JWT 令牌操作工具类
 */
@Component
public class JwtUtils {

    // 与测试类中完全一致的密钥字符串（长度需 >= 32 字节以满足 HS256）
    private static final String SECRET_STR = "abcdefghijklmnopq1234567fsfegsgjtdfjj890xyzabcd";

    // 令牌有效期：12 小时（毫秒）
    private static final long EXPIRATION_MS = 12 * 60 * 60 * 1000L;

    // 预构建密钥对象，避免每次调用都重新生成
    private static final SecretKey KEY = Keys.hmacShaKeyFor(SECRET_STR.getBytes());

    /**
     * 生成 JWT 令牌
     *
     * @param claims 自定义声明数据（如 id、username 等），不能为 null
     * @return 紧凑格式的 JWT 字符串
     */
    public static String generateToken(Map<String, Object> claims) {
        return Jwts.builder()
                .addClaims(claims)
                .setExpiration(new Date(System.currentTimeMillis() + EXPIRATION_MS))
                .signWith(KEY)
                .compact();
    }

    /**
     * 解析 JWT 令牌
     *
     * @param token JWT 字符串
     * @return Claims 对象，包含所有自定义声明及标准声明；若令牌无效或已过期将抛出异常
     */
    public static Claims parseToken(String token) {
        return Jwts.parser()
                .setSigningKey(KEY)
                .build()
                .parseClaimsJws(token)
                .getBody();
    }
}
