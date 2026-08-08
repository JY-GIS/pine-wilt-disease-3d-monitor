package com.songcai.service.impl;

import com.songcai.mapper.DiseasedTreeMapper;
import com.songcai.mapper.UserMapper;
import com.songcai.pojo.LoginInfo;
import com.songcai.pojo.User;
import com.songcai.service.UserService;
import com.songcai.utils.JwtUtils;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Slf4j
@Service
public class UserServiceImpl implements UserService {

    @Autowired
    private UserMapper UserMapper;
    @Autowired
    private DiseasedTreeMapper diseasedTreeMapper;

    @Override
    public List<User> findAll() {
        return UserMapper.findAll();
    }

    @Transactional(rollbackFor = {Exception.class})  //事务回滚
    @Override
    public void deleteById(String userId){

        diseasedTreeMapper.deleteBySurveyId(userId);
//        int i = 1/0;
        UserMapper.deleteById(userId);
    }

    @Override
    public void addInfor(User user){
        UserMapper.addInfo(user);
    }

    @Override
    public List<User> getInfo(String userID){
        return UserMapper.getInfo(userID);
    }

    @Override
    public void updateName(String userId, String username){
        UserMapper.updateName(userId,username);
    }

    @Override
    public void updatePhone(String userId,String phone){
        UserMapper.updatePhone(userId,phone);
    }

    @Override
    public LoginInfo login(User user) {
        user.setUserId(user.getPassword());
        // 1、调用 mapper接口
        User u = UserMapper.selectByUsernameAndUserId(user);
        // 2、判断是否存在这个调查员
        if(u != null){
            log.info("登录成功,员工信息:{}",u);
            // 3、生成 JWT 令牌
            Map<String,Object> claims = new HashMap<>();
            claims.put("userId",u.getUserId());
            claims.put("username",u.getUsername());
            String jwt = JwtUtils.generateToken(claims);
            return new LoginInfo(u.getUserId(),u.getUsername(),null,jwt);
        }
        return null;
    }

}
