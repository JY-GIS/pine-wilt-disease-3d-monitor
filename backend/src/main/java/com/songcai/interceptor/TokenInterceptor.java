package com.songcai.interceptor;

import com.songcai.utils.JwtUtils;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

@Slf4j
@Component
public class TokenInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {

        // 放行 CORS 预检请求
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            return true;
        }

        // 1、获取到请求的路径
        String requestURI = request.getRequestURI();  //    /employee/login

        // 2、是否是登录请求
        if(requestURI.contains("/login")){
            log.info("登录请求,放行");
            return true;
        }

        // 3、获取请求头中的 token
        String token = request.getHeader("token");

        // 4、判断 token是否存在
        if(token == null || token.isEmpty()){
            log.info("令牌为空,响应401");
            response.setStatus(401);
            return false;
        }

        // 5、如果存在。校验令牌
        try {
            JwtUtils.parseToken(token);
        } catch (Exception e) {
            log.info("令牌非法,响应401");
            response.setStatus(401);
            return false;
        }

        // 6、校验通过，放行
        log.info("令牌合法,放行");
        return true;
    }

}
